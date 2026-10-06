import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import type { InferenceEngine } from "../inference/engine.ts";
import {
  EventReader,
  type GatewayUsage,
  type Meter,
  meterCost,
  type RequestRecord,
  summarize,
} from "./usage.ts";

/** The OpenAI-compatible routes the agent may call; nothing else reaches the engine. */
const ROUTES = new Set(["POST /v1/chat/completions", "POST /v1/completions", "GET /v1/models"]);
/** A prompt of a few hundred thousand tokens is a few megabytes of JSON. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Below the 100 seconds after which Runpod's proxy drops a request that got no response. */
const KEEP_ALIVE_MS = 20_000;

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Whether `token` hashes to `hash`, in constant time. */
export function matches(token: string | undefined, hash: string | undefined): boolean {
  if (!token || !hash) return false;
  const given = Buffer.from(sha256(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A run the gateway serves: who may call it, and what it may spend. */
export interface RunSettings {
  /** SHA-256, in hex, of the run's token. */
  tokenSha256: string;
  /** What the run may spend, in USD. */
  limit: number;
  meter: Meter;
  /** When the run's cost starts, in milliseconds since the epoch: a new pod's creation. */
  start: number;
}

/** A request on its way to the engine: an OpenAI-compatible route, such as `/v1/models`. */
export interface UpstreamRequest {
  method: string;
  path: string;
  body: string | undefined;
  /** Aborted when the agent stops waiting. */
  signal: AbortSignal;
}

/** The engine's answer; the gateway waits for it, and keeps a stream alive meanwhile. */
export interface UpstreamResponse {
  status: number;
  contentType: string | undefined;
  body: AsyncIterable<Uint8Array | string>;
}

/** How the gateway reaches the engine, when not by plain HTTP. */
export type Upstream = (request: UpstreamRequest) => Promise<UpstreamResponse>;

export interface GatewayOptions {
  /** The engine's OpenAI-compatible API, such as `http://127.0.0.1:11434/v1`. */
  upstream: string;
  /** Headers for the engine, such as a Serverless key. Never shown to the agent. */
  upstreamHeaders?: Record<string, string>;
  /** Reaches the engine instead of HTTP to `upstream`, such as through a provider's job queue. */
  send?: Upstream;
  engine: InferenceEngine;
  /** SHA-256, in hex, of the token that may manage runs over HTTP; none disables those routes. */
  adminSha256?: string | undefined;
  now?: () => number;
  keepAliveMs?: number;
  log?: (message: string) => void;
}

/**
 * Codeman's gateway, in front of an engine: it serves one run at a time, to whoever holds that
 * run's token, records each request, and stops serving once the run's budget is spent. In a pod
 * it is reached through the provider's public proxy; for Serverless the agent job runs it on
 * the loopback, outside the sandbox. See docs/architecture.md#self-hosted-inference.
 */
export class Gateway {
  readonly #options: GatewayOptions;
  readonly #now: () => number;
  #run: (RunSettings & { active: boolean }) | undefined;
  #records: RequestRecord[] = [];
  /** The last time a request arrived or a run started or ended. */
  lastActivity: number;
  ready = false;
  contextLength: number | undefined;

  constructor(options: GatewayOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.lastActivity = this.#now();
  }

  /** Starts a run, whose token replaces any earlier one. */
  startRun(run: RunSettings): void {
    this.#run = { ...run, active: true };
    this.#records = [];
    this.lastActivity = this.#now();
  }

  /** Ends the run: its token stops working. Returns what it used. */
  endRun(): GatewayUsage | undefined {
    const usage = this.usage();
    if (this.#run) this.#run.active = false;
    this.lastActivity = this.#now();
    return usage;
  }

  /** What the current or last run used so far. */
  usage(): GatewayUsage | undefined {
    const run = this.#run;
    return run ? summarize(this.#records, run.meter, run.start, this.#now()) : undefined;
  }

  /** Whether a run is being served. */
  get serving(): boolean {
    return this.#run?.active === true;
  }

  /** When the current run's budget is spent, for a meter that knows in advance. */
  get deadline(): number | undefined {
    const run = this.#run;
    if (!run?.active || run.meter.kind !== "time") return undefined;
    return run.start + Math.floor((run.limit / run.meter.pricePerSecond) * 1000);
  }

  /** Whether the current run may still spend. */
  #withinBudget(): boolean {
    const run = this.#run;
    if (!run) return false;
    return meterCost(run.meter, run.start, this.#records, this.#now()) < run.limit;
  }

  status(): Record<string, unknown> {
    return {
      ready: this.ready,
      contextLength: this.contextLength,
      serving: this.serving,
      deadline: this.deadline,
      lastActivity: this.lastActivity,
    };
  }

  /** Listens on `host` (the loopback by default) and a free port unless one is given. */
  async listen(host = "127.0.0.1", port = 0): Promise<{ server: Server; url: string }> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        this.#log(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!response.headersSent) send(response, 500, { error: { message: "Gateway error." } });
        else response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    const address = server.address() as AddressInfo;
    return { server, url: `http://${host}:${address.port}` };
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const route = `${request.method} ${path}`;
    if (route === "GET /health") return send(response, 200, { ready: this.ready });
    if (path.startsWith("/admin/") || path === "/usage")
      return this.#admin(route, request, response);
    if (!ROUTES.has(route)) return send(response, 404, error("Not found."));

    if (!this.serving || !matches(bearer(request), this.#run?.tokenSha256)) {
      return send(response, 401, error("Invalid token."));
    }
    this.lastActivity = this.#now();
    if (!this.#withinBudget()) {
      return send(response, 402, error("This run's budget is spent.", "budget_exceeded"));
    }
    if (!this.ready) return send(response, 503, error("The model is not loaded yet."));
    await this.#forward(request, response, path);
  }

  async #admin(route: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!matches(bearer(request), this.#options.adminSha256)) {
      return send(response, 401, error("Invalid token."));
    }
    if (route === "GET /usage") return send(response, 200, this.usage() ?? null);
    if (route === "GET /admin/status") return send(response, 200, this.status());
    if (route === "POST /admin/run") {
      const body = parseJson(await readBody(request, 64 * 1024));
      const run = runSettings(body);
      if (!run) return send(response, 400, error("Invalid run."));
      this.startRun(run);
      return send(response, 200, this.status());
    }
    if (route === "POST /admin/end") return send(response, 200, this.endRun() ?? null);
    return send(response, 404, error("Not found."));
  }

  async #forward(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    let body: string | undefined;
    let stream = false;
    if (request.method === "POST") {
      const json = parseJson(await readBody(request, MAX_BODY_BYTES));
      if (typeof json !== "object" || json === null) {
        return send(response, 400, error("The body must be a JSON object."));
      }
      const payload = json as Record<string, unknown>;
      stream = payload.stream === true;
      // Ask for usage in the stream's last chunk, so the run's tokens are known.
      if (stream) {
        const options = typeof payload.stream_options === "object" ? payload.stream_options : {};
        payload.stream_options = { ...options, include_usage: true };
      }
      body = JSON.stringify(payload);
    }
    const record: RequestRecord = { start: this.#now(), streamed: stream };
    this.#records.push(record);
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });

    // A streamed response starts at once and stays alive while the engine is silent.
    let lastWrite = this.#now();
    const reader = new EventReader((data) => {
      const usage = this.#options.engine.usage(data);
      if (usage) Object.assign(record, usage);
    });
    const keepAlive = stream
      ? setInterval(
          () => {
            if (this.#now() - lastWrite < (this.#options.keepAliveMs ?? KEEP_ALIVE_MS)) return;
            if (!response.headersSent) response.writeHead(200, SSE_HEADERS);
            if (reader.atBoundary) response.write(": keep-alive\n\n");
            lastWrite = this.#now();
          },
          Math.max(1, Math.floor((this.#options.keepAliveMs ?? KEEP_ALIVE_MS) / 2)),
        )
      : undefined;

    try {
      const send = this.#options.send ?? this.#http;
      const upstream = await send({
        method: request.method ?? "GET",
        path,
        body,
        signal: abort.signal,
      });
      const contentType = upstream.contentType ?? "application/json";
      const status = upstream.status;
      const decoder = new TextDecoder();
      const decode = (chunk: Uint8Array | string) =>
        typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (status < 200 || status >= 300) {
        let text = "";
        for await (const chunk of upstream.body) {
          if (text.length < 4000) text += decode(chunk);
        }
        text = text.slice(0, 4000);
        record.end = this.#now();
        if (response.headersSent) {
          // The stream already started: the error becomes its only event.
          response.end(
            `data: ${JSON.stringify(error(text || "Engine error.", `upstream_${status}`))}\n\n`,
          );
        } else {
          response.writeHead(status, { "Content-Type": contentType });
          response.end(text);
        }
        return;
      }
      if (!response.headersSent) {
        response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-cache" });
      }
      let text = "";
      for await (const chunk of upstream.body) {
        record.firstByte ??= this.#now();
        const part = decode(chunk);
        if (stream) reader.feed(part);
        else text += part;
        response.write(chunk);
        lastWrite = this.#now();
      }
      record.end = this.#now();
      if (!stream) {
        const usage = this.#options.engine.usage(parseJson(text));
        if (usage) Object.assign(record, usage);
      }
      response.end();
    } catch (failure) {
      record.end ??= this.#now();
      if (abort.signal.aborted) return;
      this.#log(
        `The engine failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      if (!response.headersSent) send(response, 502, error("The engine did not answer."));
      else response.end(`data: ${JSON.stringify(error("The engine did not answer."))}\n\n`);
    } finally {
      clearInterval(keepAlive);
      this.lastActivity = this.#now();
    }
  }

  /** The engine at `upstream`, over HTTP. */
  readonly #http: Upstream = async (request) => {
    const response = await forward(`${this.#options.upstream}${request.path.slice("/v1".length)}`, {
      method: request.method,
      headers: {
        ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...this.#options.upstreamHeaders,
      },
      body: request.body,
      signal: request.signal,
    });
    return {
      status: response.statusCode ?? 502,
      contentType: header(response.headers["content-type"]),
      body: response as AsyncIterable<Buffer>,
    };
  };

  #log(message: string): void {
    this.#options.log?.(message);
  }
}

/**
 * Sends a request to the engine with `node:http`, which, unlike `fetch`, does not give up on a
 * response that takes minutes to start, such as a long prompt or a worker's cold start.
 */
function forward(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    signal: AbortSignal;
  },
): Promise<IncomingMessage> {
  const request = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal,
    });
    outgoing.on("response", resolve);
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function error(message: string, code?: string): { error: { message: string; code?: string } } {
  return { error: { message: `Codeman gateway: ${message}`, ...(code ? { code } : {}) } };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function bearer(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization ?? "";
  return /^Bearer (\S+)$/.exec(header)?.[1];
}

async function readBody(request: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new Error("The request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A run from `POST /admin/run`; undefined when a field is missing or out of range. */
export function runSettings(body: unknown): RunSettings | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { tokenSha256, limit, start, pricePerSecond, idleSeconds } = body as Record<
    string,
    unknown
  >;
  const positive = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  if (typeof tokenSha256 !== "string" || !/^[0-9a-f]{64}$/.test(tokenSha256)) return undefined;
  if (!positive(limit) || !positive(start) || !positive(pricePerSecond)) return undefined;
  if (idleSeconds === undefined) {
    return { tokenSha256, limit, start, meter: { kind: "time", pricePerSecond } };
  }
  if (typeof idleSeconds !== "number" || !Number.isFinite(idleSeconds) || idleSeconds < 0) {
    return undefined;
  }
  return {
    tokenSha256,
    limit,
    start,
    meter: { kind: "busy", pricePerSecond, idleMs: idleSeconds * 1000 },
  };
}
