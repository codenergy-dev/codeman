import { readFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { type FakeRequest, FakeServer, HttpError, json, type Reply } from "../http.ts";
import type { ChatRequest } from "../openrouter/chat.ts";
import { forward } from "../runpod/proxy.ts";
import { fromAgent, identify } from "./identify.ts";
import { ScriptedModel } from "./model.ts";
import { reply, sendReply, type WireReply } from "./openai.ts";
import { isScenarioName, scriptOf } from "./script.ts";

/**
 * The tee of an e2e pod image: it takes the engine's port (Ollama's 11434, vLLM's 8000), in
 * front of the real engine moved one port up, so the shipped `dist/gateway.js` runs unchanged on
 * a CPU with the scripted model's replies (decision 3 and spike 0.1 of
 * docs/plans/2026-10-20-end-to-end-test-suite.md).
 *
 * - **Chat from the agent** (`POST /v1/chat/completions` whose user messages hold Codeman's
 *   harness prompt): the engine gets a short fixed prompt instead, with `temperature: 0`,
 *   `max_tokens` capped and the same model, plus a `ping` tool when the agent offered tools. Once
 *   the engine's reply has ended, the agent gets the scripted reply, streamed or whole as it asked.
 *   An engine error goes back unchanged instead.
 * - **Other chat**, such as the gateway's probe of tool calls (src/gateway/vllm.ts), goes to the
 *   engine unchanged: the probe needs the engine's own parsed tool call.
 * - **`GET /api/ps`** (Ollama): `size_vram` is rewritten against a virtual VRAM budget, so the
 *   gateway's fit (src/gateway/pod.ts, `prepareOllama`; fit.ts, `onGpu`) searches on the engine's
 *   real sizes. On a CPU, Ollama reports `size_vram: 0`.
 * - **`POST /api/pull`** (Ollama): answered without a registry, from the engine's `/api/tags`.
 *   Offline, a real pull fails or hangs even when the model is present (spike 0.1).
 * - **Every other route** goes to the engine unchanged: those the gateway calls are Ollama's
 *   `/api/version`, `/api/show`, `/api/tags`, `/api/generate` (the load, `keep_alive: -1`), and
 *   vLLM's `/health`, `/v1/models` and `/metrics`; the agent's `/v1/models` and
 *   `/v1/completions` too.
 *
 * Its inspection API, `/_fake/tee/` on its own port and on the engine's:
 *
 * - `GET /requests`: each chat request, with what the scripted model takes it for, and when the
 *   engine started and ended it, its status, usage and error, so a scenario can count how many ran
 *   at once;
 * - `DELETE /requests`;
 * - `PUT /vram` `{ bytes }`: the virtual VRAM, or null to leave `/api/ps` as the engine says.
 */

/** Where the scripted replies come from: the scripted model's server, or one in this process. */
export type ScriptSource = (request: ChatRequest, signal: AbortSignal) => Promise<WireReply>;

/** The short prompt the engine gets in place of the agent's. */
export const ENGINE_PROMPT = "Reply with the single word OK.";

/** The tool the engine gets when the agent offered tools, so its tool-call parser runs. */
export const PING_TOOL = {
  type: "function",
  function: {
    name: "ping",
    description: "Checks that tools work. Takes no arguments.",
    parameters: { type: "object", properties: {} },
  },
};

export interface TeeSetup {
  /** The real engine's origin, such as `http://127.0.0.1:11435`. */
  engine: string;
  script: ScriptSource;
  /** The virtual VRAM for `/api/ps`, in bytes; undefined leaves it as the engine says. */
  vramBytes?: number | undefined;
  /** The engine's `max_tokens` for an agent's request: 8 by default. */
  maxTokens?: number;
}

/** What the tee saw of one chat request. */
export interface TeeRecord {
  id: number;
  /** `agent`: the engine got the short prompt; `passthrough`: the request as it came. */
  kind: "agent" | "passthrough";
  model: string;
  stream: boolean;
  /** When the request arrived, and when its reply ended, in milliseconds since the epoch. */
  at: number;
  end?: number;
  /** What the scripted model takes the request for, as far as its content tells. */
  identified?: Record<string, unknown>;
  engine: {
    start: number;
    end?: number;
    status?: number;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: string;
  };
}

export class Tee {
  readonly server: FakeServer;
  /** The inspection API alone, for its own port. */
  readonly inspection: FakeServer;
  readonly records: TeeRecord[] = [];
  vramBytes: number | undefined;
  readonly #setup: TeeSetup;
  readonly #now: () => number;
  #next = 1;

  constructor(setup: TeeSetup, options: { now?: () => number } = {}) {
    this.#setup = setup;
    this.#now = options.now ?? Date.now;
    this.vramBytes = setup.vramBytes;
    const server = new FakeServer("tee");
    this.server = server;
    this.inspection = new FakeServer("tee-inspection");
    for (const fake of [server, this.inspection]) this.#control(fake);

    server.route("POST", "/v1/chat/completions", (request, response) =>
      this.#chat(request, response),
    );
    server.route("GET", "/api/ps", (request, response) => this.#ps(request, response));
    server.route("POST", "/api/pull", (request) => this.#pull(request));
    const pass = (request: FakeRequest, response: ServerResponse) =>
      forward(`${setup.engine}${request.path}`, request, response).then(() => undefined);
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]) {
      server.route(method, "/", pass);
      server.route(method, "/{path*}", pass);
    }
  }

  #control(fake: FakeServer): void {
    fake.control("GET", "/tee/requests", () => json(this.records));
    fake.control("DELETE", "/tee/requests", () => {
      this.records.length = 0;
      return { status: 204 };
    });
    fake.control("PUT", "/tee/vram", (request) => {
      const { bytes } = (request.json() ?? {}) as { bytes?: unknown };
      if (bytes !== null && !(Number.isInteger(bytes) && (bytes as number) >= 0)) {
        throw new HttpError(400, { message: "The body is { bytes }, a count or null." });
      }
      this.vramBytes = bytes === null ? undefined : (bytes as number);
      return { status: 204 };
    });
    fake.onReset(() => {
      this.records.length = 0;
      this.vramBytes = this.#setup.vramBytes;
    });
  }

  async #chat(request: FakeRequest, response: ServerResponse): Promise<undefined> {
    const body = request.json() as ChatRequest;
    if (typeof body?.model !== "string" || !Array.isArray(body.messages)) {
      throw new HttpError(400, { error: { message: "model and messages are required." } });
    }
    const record: TeeRecord = {
      id: this.#next++,
      kind: fromAgent(body) ? "agent" : "passthrough",
      model: body.model,
      stream: body.stream === true,
      at: this.#now(),
      engine: { start: this.#now() },
    };
    this.records.push(record);
    if (record.kind === "passthrough") {
      await forward(`${this.#setup.engine}${request.path}`, request, response);
      record.engine.end = record.end = this.#now();
      record.engine.status = response.headersSent ? response.statusCode : 502;
      return undefined;
    }
    const found = identify(body);
    const { kind, ...fields } = found;
    record.identified = { kind, ...fields };
    const abort = new AbortController();
    response.once("close", () => {
      if (!response.writableFinished) abort.abort();
    });

    const stream = body.stream === true;
    const engineBody = {
      model: body.model,
      messages: [{ role: "user", content: ENGINE_PROMPT }],
      temperature: 0,
      max_tokens: this.#setup.maxTokens ?? 8,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(Array.isArray(body.tools) && body.tools.length > 0
        ? { tools: [PING_TOOL], tool_choice: "auto" }
        : {}),
    };
    let answer: { status: number; contentType: string; text: string };
    try {
      const message = await call(`${this.#setup.engine}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify(engineBody),
        signal: abort.signal,
      });
      answer = {
        status: message.statusCode ?? 502,
        contentType: header(message.headers["content-type"]) ?? "application/json",
        text: await text(message),
      };
    } catch (error) {
      record.engine.end = record.end = this.#now();
      record.engine.error = error instanceof Error ? error.message : String(error);
      if (abort.signal.aborted) return undefined;
      throw new HttpError(502, { error: { message: "The engine did not answer." } });
    }
    record.engine.end = this.#now();
    record.engine.status = answer.status;
    const outcome = engineOutcome(answer.text, answer.contentType);
    if (outcome.usage) record.engine.usage = outcome.usage;
    if (answer.status < 200 || answer.status >= 300 || outcome.error) {
      // The gateway's handling of an engine's error runs on the engine's own answer.
      record.engine.error = outcome.error ?? answer.text.slice(0, 2000);
      response.writeHead(answer.status, { "content-type": answer.contentType }).end(answer.text);
      record.end = this.#now();
      return undefined;
    }
    if (abort.signal.aborted) return undefined;
    await sendReply(response, await this.#setup.script(body, abort.signal));
    record.end = this.#now();
    return undefined;
  }

  /** `/api/ps` with each model's `size_vram` taken from the virtual VRAM, in order. */
  async #ps(request: FakeRequest, response: ServerResponse): Promise<Reply | undefined> {
    const budget = this.vramBytes;
    if (budget === undefined) {
      await forward(`${this.#setup.engine}${request.path}`, request, response);
      return undefined;
    }
    const message = await call(`${this.#setup.engine}/api/ps`, { method: "GET" });
    const body = await text(message);
    if (message.statusCode !== 200) {
      return {
        status: message.statusCode ?? 502,
        body,
        headers: { "content-type": "application/json" },
      };
    }
    const ps = JSON.parse(body) as { models?: { size?: unknown; size_vram?: unknown }[] };
    let left = budget;
    for (const model of ps.models ?? []) {
      if (typeof model.size !== "number") continue;
      const vram = Math.max(0, Math.min(model.size, left));
      model.size_vram = vram;
      left -= vram;
    }
    return json(ps);
  }

  /**
   * Ollama's pull answer for a model the engine has, without a registry; for one it lacks, the
   * error a pull without the network ends with.
   */
  async #pull(request: FakeRequest): Promise<Reply> {
    const body = (request.json() ?? {}) as { model?: unknown; name?: unknown; stream?: unknown };
    const model = typeof body.model === "string" ? body.model : body.name;
    if (typeof model !== "string" || model === "") {
      return json({ error: "model is required" }, 400);
    }
    const stream = body.stream !== false;
    const ndjson = { "content-type": "application/x-ndjson" };
    const lines = (items: unknown[]) => items.map((item) => `${JSON.stringify(item)}\n`).join("");
    const tags = await call(`${this.#setup.engine}/api/tags`, { method: "GET" }).then(
      async (message) => ({ status: message.statusCode ?? 502, text: await text(message) }),
      (error: unknown) => ({ status: 502, text: String(error) }),
    );
    if (tags.status !== 200) {
      return json({ error: `the e2e tee could not list the engine's models: ${tags.text}` }, 500);
    }
    const names = [model, model.includes(":") ? model : `${model}:latest`];
    const entry = (
      (JSON.parse(tags.text) as { models?: unknown }).models as
        | { name?: unknown; model?: unknown; digest?: unknown; size?: unknown }[]
        | undefined
    )?.find((one) => names.includes(one.name as string) || names.includes(one.model as string));
    if (!entry) {
      const error = `pull model manifest: the e2e tee pulls no model, and the engine has no ${model}`;
      if (!stream) return json({ error }, 500);
      return {
        status: 200,
        headers: ndjson,
        body: lines([{ status: "pulling manifest" }, { error }]),
      };
    }
    if (!stream) return json({ status: "success" });
    const size = typeof entry.size === "number" ? entry.size : 0;
    return {
      status: 200,
      headers: ndjson,
      body: lines([
        { status: "pulling manifest" },
        ...(typeof entry.digest === "string"
          ? [
              {
                status: `pulling ${entry.digest.slice(0, 12)}`,
                digest: `sha256:${entry.digest}`,
                total: size,
                completed: size,
              },
            ]
          : []),
        { status: "verifying sha256 digest" },
        { status: "writing manifest" },
        { status: "success" },
      ]),
    };
  }
}

/** The scripted model's server at `origin` as the replies' source. */
export function remoteScripts(origin: string): ScriptSource {
  return async (request, signal) => {
    const message = await call(`${origin}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    });
    return {
      status: message.statusCode ?? 502,
      headers: { "content-type": header(message.headers["content-type"]) ?? "application/json" },
      body: (async function* () {
        const decoder = new TextDecoder();
        for await (const chunk of message as AsyncIterable<Buffer>) {
          yield decoder.decode(chunk, { stream: true });
        }
      })(),
    };
  };
}

/** A scripted model in this process as the replies' source. */
export function localScripts(model: ScriptedModel): ScriptSource {
  return async (request, signal) => reply(model, request, "tee", signal);
}

/** What the engine's answer said: its usage, and an error inside a 200, as a stream may end. */
function engineOutcome(
  body: string,
  contentType: string,
): { usage?: TeeRecord["engine"]["usage"]; error?: string } {
  const parse = (data: string): Record<string, unknown> | undefined => {
    try {
      const value: unknown = JSON.parse(data);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const objects = contentType.startsWith("text/event-stream")
    ? body
        .replaceAll("\r\n", "\n")
        .split("\n\n")
        .map((block) =>
          block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trim())
            .join("\n"),
        )
        .filter((data) => data !== "" && data !== "[DONE]")
        .map(parse)
    : [parse(body)];
  const outcome: { usage?: TeeRecord["engine"]["usage"]; error?: string } = {};
  for (const object of objects) {
    if (object?.usage) outcome.usage = object.usage as TeeRecord["engine"]["usage"];
    if (object?.error) outcome.error = JSON.stringify(object.error);
  }
  return outcome;
}

/**
 * A request with `node:http`, which, unlike `fetch`, never gives up on an answer that takes
 * minutes, such as vLLM's first one on a CPU, or a scripted `hang`.
 */
function call(
  url: string,
  options: { method: string; body?: string; signal?: AbortSignal },
): Promise<IncomingMessage> {
  const send = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(
      url,
      {
        method: options.method,
        headers: options.body === undefined ? {} : { "content-type": "application/json" },
        ...(options.signal ? { signal: options.signal } : {}),
      },
      resolve,
    );
    outgoing.once("error", reject);
    outgoing.end(options.body);
  });
}

async function text(message: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of message as AsyncIterable<Buffer>) body += chunk.toString("utf8");
  return body;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The tee for e2e/fakes/main.ts, on `PORT` (the engine's: 11434 or 8000), from:
 *
 * - `TEE_ENGINE`: the real engine's origin, such as `http://127.0.0.1:11435`;
 * - `TEE_MODEL`: the scripted model's origin (e2e/fakes/llm/llm.ts), or `TEE_SCRIPTS`: a JSON
 *   file of scripts by scenario, played in this process;
 * - `TEE_VRAM_BYTES`: the virtual VRAM for Ollama's `/api/ps`; without it, `/api/ps` passes;
 * - `TEE_MAX_TOKENS`: the engine's `max_tokens` for an agent's request, 8 by default;
 * - `TEE_CONTROL_PORT`: the inspection API's own port, 9091 by default, on `HOST`.
 */
export async function fromEnv(env: NodeJS.ProcessEnv): Promise<FakeServer> {
  const origin = (name: string, value: string | undefined) => {
    if (value === undefined || URL.parse(value)?.origin !== value) {
      throw new Error(`${name} must be an origin, such as http://127.0.0.1:11435.`);
    }
    return value;
  };
  const count = (name: string, value: string | undefined, fallback?: number) => {
    if (value === undefined || value === "") return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a count.`);
    return number;
  };
  if (!env.TEE_MODEL === !env.TEE_SCRIPTS) {
    throw new Error(
      "The tee needs one of TEE_MODEL, the scripted model's origin, and TEE_SCRIPTS.",
    );
  }
  let script: ScriptSource;
  if (env.TEE_MODEL) script = remoteScripts(origin("TEE_MODEL", env.TEE_MODEL));
  else {
    const model = new ScriptedModel();
    const scripts = JSON.parse(readFileSync(env.TEE_SCRIPTS as string, "utf8")) as Record<
      string,
      unknown
    >;
    for (const [scenario, value] of Object.entries(scripts)) {
      if (!isScenarioName(scenario)) throw new Error(`TEE_SCRIPTS: "${scenario}" is not a name.`);
      model.load(scenario, scriptOf(value));
    }
    script = localScripts(model);
  }
  const tee = new Tee({
    engine: origin("TEE_ENGINE", env.TEE_ENGINE),
    script,
    vramBytes: count("TEE_VRAM_BYTES", env.TEE_VRAM_BYTES),
    maxTokens: count("TEE_MAX_TOKENS", env.TEE_MAX_TOKENS, 8) as number,
  });
  const inspection = await tee.inspection.listen({
    host: env.HOST ?? "0.0.0.0",
    port: count("TEE_CONTROL_PORT", env.TEE_CONTROL_PORT, 9091) as number,
    controlToken: env.FAKE_CONTROL_TOKEN || undefined,
  });
  console.log(`The tee's inspection API listens on ${inspection}.`);
  return tee.server;
}
