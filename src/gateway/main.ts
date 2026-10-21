import { type ChildProcess, spawn } from "node:child_process";
import { E2E } from "../e2e.ts";
import type { InferenceEngine } from "../inference/engine.ts";
import { OLLAMA_URL, ollama } from "../inference/ollama.ts";
import { Runpod } from "../inference/runpod.ts";
import { VLLM_URL, vllm } from "../inference/vllm.ts";
import { Gateway } from "./gateway.ts";
import {
  expiry,
  FAILURE_GRACE_MS,
  type FitReport,
  fitOptions,
  GATEWAY_PORT,
  ollamaServeEnvironment,
  type PodSettings,
  podSettings,
  prepareOllama,
} from "./pod.ts";
import {
  prepareVllm,
  type VllmFitReport,
  vllmError,
  vllmServeArguments,
  vllmServeEnvironment,
} from "./vllm.ts";

/** The engines a pod image serves, by `CODEMAN_ENGINE`. */
const ENGINES: Readonly<Record<string, { engine: InferenceEngine; url: string }>> = {
  ollama: { engine: ollama, url: OLLAMA_URL },
  vllm: { engine: vllm, url: VLLM_URL },
};

/** Lines of vLLM's output kept for the reasons of a failed start and its auto-fit. */
const KEPT_LINES = 400;

/**
 * The pod's entry point, in Codeman's pod images: serves the model through the gateway with the
 * image's engine, and terminates the pod when it is no longer useful. Runs as `node gateway.js`.
 */
async function main(): Promise<void> {
  const settings = podSettings(process.env);
  const log = (message: string) => console.log(`[codeman] ${message}`);
  let engineProcess: ChildProcess | undefined;
  const terminate = async (reason: string): Promise<never> => {
    log(`Terminating the pod: ${reason}.`);
    if (settings.podId && settings.podKey) {
      // The e2e build's pods reach the fake Runpod (src/e2e.ts); the published build, Runpod.
      const runpod = E2E
        ? E2E.gpu(new Runpod(settings.podKey, E2E.fetch))
        : new Runpod(settings.podKey);
      await runpod.pods.terminate(settings.podId).catch((error: unknown) => {
        log(`Could not terminate the pod: ${error instanceof Error ? error.message : error}`);
      });
    }
    await stop(engineProcess);
    // Should the provider not terminate it, the container stops when its main process exits.
    process.exit(0);
  };

  // A pod restarted after its first start must not serve again, nor pull the model again.
  if (Date.now() >= settings.policy.startBy) await terminate("it started after its start limit");
  const served = ENGINES[settings.engine];
  if (!served || settings.engine !== settings.imageEngine) {
    await terminate(
      `it was created for the engine ${settings.engine}, and its image serves ${settings.imageEngine}`,
    );
  }
  // A requested setting is never dropped: a pod that cannot read them does not serve.
  if (!settings.ollama.ok) {
    await terminate(`its Ollama settings cannot be applied: ${settings.ollama.error}`);
  }
  if (!settings.vllm.ok) {
    await terminate(`its vLLM settings cannot be applied: ${settings.vllm.error}`);
  }
  const { engine, url } = served as NonNullable<typeof served>;

  const gateway = new Gateway({
    upstream: `${url}/v1`,
    engine,
    adminSha256: settings.adminSha256,
    log,
  });
  await gateway.listen("0.0.0.0", GATEWAY_PORT);
  log(`Gateway listening on port ${GATEWAY_PORT}.`);
  setInterval(() => {
    // Spent or silent runs stop, alone or all together, and take no more of the pod's time. A
    // pod left without a run waits for the key jobs that end them and read their usage.
    gateway.expireRuns(settings.policy.runIdleMs);
    const reason = expiry(gateway, settings.policy, Date.now());
    if (reason) void terminate(reason);
  }, 15_000).unref();

  try {
    const fit =
      settings.engine === "vllm"
        ? await serveVllm(settings, gateway, log, (child) => {
            engineProcess = child;
          })
        : await serveOllama(settings, gateway, log, (child) => {
            engineProcess = child;
          });
    gateway.fit = fit;
    gateway.contextLength = fit.contextLength;
    gateway.ready = true;
    gateway.lastActivity = Date.now();
    log("Ready.");
  } catch (error) {
    // The key jobs read why from the gateway's status while they wait for the pod, then
    // terminate it; it terminates itself in a while, should none of them.
    const message = error instanceof Error ? error.message : String(error);
    const reason = `the model could not be served: ${message}`;
    gateway.failure = message;
    log(`Not serving ${settings.model}: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, FAILURE_GRACE_MS));
    await terminate(reason);
  }
}

/** Starts Ollama with the pod's settings, and fits the model to the GPU. */
async function serveOllama(
  settings: PodSettings,
  gateway: Gateway,
  log: (message: string) => void,
  running: (child: ChildProcess) => void,
): Promise<FitReport> {
  const variables = settings.ollama.ok ? settings.ollama.value : {};
  const names = Object.entries(variables).map(([name, value]) => `${name}=${value}`);
  if (names.length > 0) log(`Ollama settings: ${names.join(", ")}.`);
  gateway.ollama = variables;
  let child = serveOllamaProcess(variables, undefined);
  running(child);
  return prepareOllama(
    {
      url: OLLAMA_URL,
      restart: async (contextLength) => {
        await stop(child);
        child = serveOllamaProcess(variables, contextLength);
        running(child);
      },
    },
    settings.model,
    log,
    fitOptions(variables, settings),
  );
}

/** Starts vLLM with the pod's settings, for the requests the pod serves at once. */
async function serveVllm(
  settings: PodSettings,
  gateway: Gateway,
  log: (message: string) => void,
  running: (child: ChildProcess) => void,
): Promise<VllmFitReport> {
  const values = settings.vllm.ok ? settings.vllm.value : {};
  const names = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  log(`vLLM settings: ${names.join(", ")}.`);
  gateway.vllm = values;
  const toolCallParser = values["tool-call-parser"];
  if (!toolCallParser) throw new Error("CODEMAN_VLLM has no `tool-call-parser`.");
  let child: ChildProcess | undefined;
  let lines: string[] = [];
  let stopped: string | undefined;
  const configured = Number(values["max-model-len"] ?? "") || undefined;
  return prepareVllm(
    {
      url: VLLM_URL,
      start: async (maxModelLen) => {
        await stop(child);
        lines = [];
        stopped = undefined;
        const started = spawn("vllm", vllmServeArguments(settings.model, values, maxModelLen), {
          env: vllmServeEnvironment(process.env),
          stdio: ["ignore", "pipe", "pipe"],
          // Its own process group, so stopping it stops the engine's processes too.
          detached: true,
        });
        const keep = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
          let rest = "";
          stream.on("data", (chunk: Buffer) => {
            out.write(chunk);
            const text = rest + chunk.toString("utf8");
            const parts = text.split("\n");
            rest = parts.pop() ?? "";
            lines.push(...parts);
            if (lines.length > KEPT_LINES) lines = lines.slice(-KEPT_LINES);
          });
        };
        keep(started.stdout, process.stdout);
        keep(started.stderr, process.stderr);
        started.once("exit", (code, signal) => {
          // Its last lines may still be on their way through the pipes.
          setTimeout(() => {
            if (child !== started) return;
            stopped = vllmError(lines, `it exited with ${signal ?? `code ${code}`}`);
          }, 1_000);
        });
        started.once("error", (error) => {
          if (child === started) stopped = `it could not start: ${error.message}`;
        });
        child = started;
        running(started);
      },
      stopped: () => stopped,
      output: () => lines,
    },
    settings.model,
    log,
    {
      configured,
      maxNumSeqs: Number(values["max-num-seqs"] ?? "") || 1,
      hint: configured ? undefined : settings.contextHint,
      toolCallParser,
    },
  );
}

/** Starts `ollama serve` on the loopback, keeping models loaded, with the pod's Ollama settings. */
function serveOllamaProcess(
  variables: Readonly<Record<string, string>>,
  contextLength: number | undefined,
): ChildProcess {
  return spawn("ollama", ["serve"], {
    stdio: "inherit",
    env: ollamaServeEnvironment(process.env, variables, contextLength),
  });
}

/**
 * Stops an engine: SIGTERM to its process group, which vLLM's engine processes share, then
 * SIGKILL to what is left, so the next start finds the GPU's memory free.
 */
async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const group = (signal: NodeJS.Signals) => {
    try {
      process.kill(-(child.pid as number), signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  group("SIGTERM");
  const killed = setTimeout(() => group("SIGKILL"), 30_000);
  await exited;
  clearTimeout(killed);
  try {
    // What is left of the group, such as an engine's process, still holds GPU memory.
    process.kill(-(child.pid as number), "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } catch {
    // The whole group is gone.
  }
}

await main();
