/**
 * The prototype's engine adapters: Ollama, which serves several models from one process and
 * loads and unloads them through its API (`keep_alive`, `/api/ps`), and a Python server started
 * as a process per service, whose memory comes back when the process exits.
 * See docs/web/ollama/generate-a-response.md and docs/web/ollama/list-running-models.md.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import {
  type EngineAdapter,
  type EngineRequest,
  type EngineResponse,
  type Footprint,
  processesWith,
  type ServiceSpec,
  treeRss,
  until,
} from "./services.ts";

/** Sends a request to an engine on the loopback, with `node:http`, which never times out. */
export function loopback(url: string, engine: EngineRequest): Promise<EngineResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: engine.method,
      headers: engine.body === undefined ? {} : { "Content-Type": "application/json" },
      signal: engine.signal,
    });
    outgoing.on("response", (response) =>
      resolve({
        status: response.statusCode ?? 502,
        contentType: response.headers["content-type"],
        body: response,
      }),
    );
    outgoing.on("error", reject);
    outgoing.end(engine.body);
  });
}

async function json(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Keeps a child's last lines, for the reason of a failed start. */
function keepLines(child: ChildProcess, lines: string[], max = 40): void {
  const keep = (chunk: Buffer) => {
    lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
    lines.splice(0, Math.max(0, lines.length - max));
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const killed = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(killed);
}

interface OllamaModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
}

/** Ollama: one `ollama serve` for every Ollama service, each model loaded and unloaded by API. */
export class OllamaAdapter implements EngineAdapter {
  readonly family = "ollama";
  readonly url: string;
  #child: ChildProcess | undefined;
  readonly #lines: string[] = [];
  /** Each model's weights file, which its llama-server process has on its command line. */
  readonly #blobs = new Map<string, string>();

  constructor(url = "http://127.0.0.1:11434") {
    this.url = url;
  }

  async start(): Promise<void> {
    // OLLAMA_KEEP_ALIVE=-1 (the image's environment): Ollama never unloads a model on its own.
    this.#child = spawn("ollama", ["serve"], { stdio: ["ignore", "pipe", "pipe"] });
    keepLines(this.#child, this.#lines);
    await until(async () => (await fetch(`${this.url}/api/version`)).ok, 30_000, "Ollama");
  }

  async load(spec: ServiceSpec): Promise<void> {
    // A request without a prompt loads the model; `keep_alive: -1` keeps it until unloaded.
    await json(`${this.url}/api/generate`, { model: spec.model, keep_alive: -1 });
    if (!(await this.health(spec))) throw new Error(`Ollama did not keep ${spec.model} loaded.`);
  }

  async unload(spec: ServiceSpec): Promise<void> {
    // `keep_alive: 0` unloads it; its llama-server process exits shortly after.
    await json(`${this.url}/api/generate`, { model: spec.model, keep_alive: 0 });
    await until(async () => !(await this.health(spec)), 30_000, `${spec.model} to unload`);
    const blob = this.#blobs.get(spec.model);
    if (blob) await until(async () => processesWith(blob).length === 0, 30_000, "llama-server");
  }

  async health(spec: ServiceSpec): Promise<boolean> {
    return (await this.#running()).some((model) => this.#is(model, spec));
  }

  routes(): string[] {
    return ["POST /v1/chat/completions"];
  }

  async footprint(spec: ServiceSpec): Promise<Footprint> {
    const reported = (await this.#running()).find((model) => this.#is(model, spec))?.size;
    const blob = await this.#blob(spec.model);
    const rss = processesWith(blob).reduce((sum, pid) => sum + treeRss(pid), 0);
    return { bytes: Math.max(reported ?? 0, rss), reported, rss };
  }

  forward(_spec: ServiceSpec, engine: EngineRequest): Promise<EngineResponse> {
    return loopback(`${this.url}${engine.path}`, engine);
  }

  /** The resident memory of `ollama serve` and its llama-server processes. */
  rss(): number {
    return this.#child?.pid ? treeRss(this.#child.pid) : 0;
  }

  async stop(): Promise<void> {
    await stopProcess(this.#child);
  }

  async #running(): Promise<OllamaModel[]> {
    const ps = (await json(`${this.url}/api/ps`)) as { models?: OllamaModel[] };
    return ps.models ?? [];
  }

  #is(model: OllamaModel, spec: ServiceSpec): boolean {
    return model.name === spec.model || model.model === spec.model;
  }

  async #blob(model: string): Promise<string> {
    let blob = this.#blobs.get(model);
    if (!blob) {
      const show = (await json(`${this.url}/api/show`, { model })) as { modelfile?: string };
      blob = /^FROM (\S+)/m.exec(show.modelfile ?? "")?.[1] ?? model;
      this.#blobs.set(model, blob);
    }
    return blob;
  }
}

interface PythonProcess {
  child: ChildProcess;
  port: number;
  lines: string[];
}

/** A free port on the loopback. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/**
 * A Python HTTP server per service (generator.py), started to load its model and stopped to
 * unload it: the process's exit gives every byte back, which on a GPU frees its CUDA context too.
 */
export class PythonAdapter implements EngineAdapter {
  readonly family = "python";
  readonly #python: string;
  readonly #script: string;
  readonly #outputs: string;
  readonly #threads: number;
  readonly #processes = new Map<string, PythonProcess>();

  constructor(options: { python: string; script: string; outputs: string; threads?: number }) {
    this.#python = options.python;
    this.#script = options.script;
    this.#outputs = options.outputs;
    this.#threads = options.threads ?? 4;
  }

  async start(): Promise<void> {
    // No shared process: each service's server starts when it loads.
  }

  async load(spec: ServiceSpec): Promise<void> {
    const port = await freePort();
    // -I: the interpreter ignores the environment and the script's directory for imports.
    const child = spawn(
      this.#python,
      ["-I", this.#script, "--port", String(port), "--model", spec.model],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: "/usr/bin:/bin",
          CODEMAN_OUTPUTS: this.#outputs,
          OMP_NUM_THREADS: String(this.#threads),
          HF_HUB_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
          DO_NOT_TRACK: "1",
        },
      },
    );
    const running: PythonProcess = { child, port, lines: [] };
    keepLines(child, running.lines);
    this.#processes.set(spec.name, running);
    // A process that exits before it serves fails the load at once.
    const exited = new Promise<never>((_, reject) =>
      child.once("exit", () => reject(new Error("exited"))),
    );
    exited.catch(() => {});
    try {
      await Promise.race([
        until(
          async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok,
          300_000,
          `${spec.name} to load`,
        ),
        exited,
      ]);
    } catch {
      await stopProcess(child);
      this.#processes.delete(spec.name);
      const reason = running.lines.slice(-3).join(" | ") || "it exited";
      throw new Error(`${spec.name} could not load: ${reason}`);
    }
  }

  async unload(spec: ServiceSpec): Promise<void> {
    await stopProcess(this.#processes.get(spec.name)?.child);
    this.#processes.delete(spec.name);
  }

  async health(spec: ServiceSpec): Promise<boolean> {
    const running = this.#processes.get(spec.name);
    if (!running || running.child.exitCode !== null) return false;
    const response = await fetch(`http://127.0.0.1:${running.port}/health`).catch(() => undefined);
    return response?.ok === true;
  }

  routes(): string[] {
    return ["POST /v1/generations", "GET /v1/generations/{id}", "GET /v1/generations/{id}/content"];
  }

  async footprint(spec: ServiceSpec): Promise<Footprint> {
    const pid = this.#processes.get(spec.name)?.child.pid;
    const rss = pid ? treeRss(pid) : 0;
    return { bytes: rss, rss };
  }

  forward(spec: ServiceSpec, engine: EngineRequest): Promise<EngineResponse> {
    const running = this.#processes.get(spec.name);
    if (!running) return Promise.reject(new Error(`${spec.name} is not loaded.`));
    return loopback(`http://127.0.0.1:${running.port}${engine.path}`, engine);
  }

  async stop(): Promise<void> {
    for (const running of this.#processes.values()) await stopProcess(running.child);
    this.#processes.clear();
  }
}
