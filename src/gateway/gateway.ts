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
  type KeptSpan,
  type Meter,
  meterCost,
  type PodRunSpan,
  podShares,
  type RequestRecord,
  summarize,
  type WorkerSample,
} from "./usage.ts";

/** The OpenAI-compatible routes the agent may call; nothing else reaches the engine. */
const ROUTES = new Set(["POST /v1/chat/completions", "POST /v1/completions", "GET /v1/models"]);
/** A task's issue number, as runs and releases name it. */
const TASK = /^\d{1,12}$/;
/** A group of runs that share a pod: the workflow run's ID and a hash of their settings. */
const GROUP = /^[\w.-]{1,100}$/;
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
  /** The task it works on, on a pod that serves several; none replaces every other run. */
  task?: string | undefined;
  /** The runs that share the pod, for those that come later to find it. */
  group?: string | undefined;
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
  /**
   * With worker samples: how long a request may wait while no worker starts or runs before
   * the run stops. Without it, a request waits as long as it takes.
   */
  noWorkerMs?: number | undefined;
  /** Told why, when the gateway stops serving the run before its end. */
  onStop?: (reason: string) => void;
  now?: () => number;
  keepAliveMs?: number;
  log?: (message: string) => void;
}

/** Why the gateway stopped a run, as the reason its open requests are aborted with. */
class RunStopped extends Error {}

/** A run as the gateway keeps it; ended runs stay, for the pod's split. */
interface Run extends RunSettings {
  id: number;
  task: string;
  active: boolean;
  /** When it ended or was stopped. */
  end?: number | undefined;
  stopped?: string | undefined;
  records: RequestRecord[];
  /** Its worker samples, in order. */
  samples: WorkerSample[];
  /** Since when samples have seen no worker starting or running while a request waited. */
  noWorkerSince?: number | undefined;
  /** When it started, or its last request arrived or ended. */
  lastActivity: number;
  /** Its requests being forwarded, to abort when it stops. */
  open: Set<AbortController>;
}

/** A task's part of a pod, and who else is on it, as one of its runs ends. */
export interface PodShare {
  /** What the task's runs and the kept time it was given cost so far, in USD. */
  taskCost: number;
  /** Every task the pod served. */
  tasks: string[];
  /** The tasks with a run on the pod now, and those that keep it for their next run. */
  active: string[];
  keepers: string[];
}

/** What `endRun` reports: the run's usage, and its task's part of the pod when it named one. */
export type EndedRun = GatewayUsage & { share?: PodShare | undefined };

/** The admin API's version, in `/admin/status`: 2 serves several runs at once; 1 lacks it. */
export const GATEWAY_VERSION = 2;

/**
 * Codeman's gateway, in front of an engine: it serves runs, each to whoever holds its token,
 * records each request, and stops serving a run once its budget is spent. In a pod it is reached
 * through the provider's public proxy, and serves the runs of several tasks at once, splitting
 * the pod's time among them; for Serverless the agent job runs it on the loopback, outside the
 * sandbox, for its one run. See docs/inference/self-hosted.md#the-gateway.
 */
export class Gateway {
  readonly #options: GatewayOptions;
  readonly #now: () => number;
  /** Every run, in the order they started. */
  readonly #runs: Run[] = [];
  /** When each task kept the pod between its runs. */
  readonly #kept: KeptSpan[] = [];
  #nextId = 1;
  /** The group of runs that share the pod, as the last run that named one gave it. */
  group: string | undefined;
  /** The last time a request arrived or a run started or ended. */
  lastActivity: number;
  ready = false;
  contextLength: number | undefined;

  constructor(options: GatewayOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.lastActivity = this.#now();
  }

  /**
   * Starts a run. A run of a task replaces that task's earlier one; a run that names no task
   * replaces every run, as when the gateway served one at a time.
   */
  startRun(settings: RunSettings): void {
    const now = this.#now();
    const task = settings.task ?? "";
    for (const run of this.#runs) {
      if (run.active && (task === "" || run.task === task)) this.#end(run, now);
    }
    this.release(task);
    this.#runs.push({
      ...settings,
      id: this.#nextId++,
      task,
      active: true,
      records: [],
      samples: [],
      lastActivity: now,
      open: new Set(),
    });
    if (settings.group) this.group = settings.group;
    this.lastActivity = now;
  }

  /**
   * Records what the provider said of the workers, for each run's busy meter. A request that
   * waits `noWorkerMs` while every sample sees no worker starting or running stops its run;
   * unknown samples neither prove a worker nor its absence.
   */
  observe(sample: WorkerSample): void {
    for (const run of this.#runs.filter((one) => one.active)) {
      run.samples.push(sample);
      const limit = this.#options.noWorkerMs;
      const waiting = run.records.some((record) => record.end === undefined);
      if (limit === undefined || sample.workers === undefined) continue;
      if (!waiting || sample.workers !== "none") {
        run.noWorkerSince = undefined;
        continue;
      }
      run.noWorkerSince ??= sample.at;
      if (sample.at - run.noWorkerSince >= limit) {
        const minutes = Math.round(limit / 60_000);
        this.#stop(
          run,
          `No worker of the endpoint started or ran for ${minutes} minutes while a request ` +
            "waited, as when it has no GPU.",
        );
      }
    }
  }

  /** Stops serving a run: its waiting requests fail with `reason`, and so do new ones. */
  #stop(run: Run, reason: string): void {
    if (!run.active) return;
    this.#end(run, this.#now());
    run.stopped = reason;
    this.#log(reason);
    for (const abort of run.open) abort.abort(new RunStopped(reason));
    this.#options.onStop?.(reason);
  }

  #end(run: Run, now: number): void {
    run.active = false;
    run.end ??= now;
    this.lastActivity = now;
  }

  /**
   * Ends a run, by its token's hash, or the last one: its token stops working. With `keep`, its
   * task keeps the pod for its next run, and is given the pod's time while no run uses it.
   * Returns what the run used.
   */
  endRun(options: { tokenSha256?: string | undefined; keep?: boolean } = {}): EndedRun | undefined {
    const run = this.#find(options.tokenSha256);
    if (!run) return undefined;
    const now = this.#now();
    this.#end(run, now);
    if (options.keep && run.task && !this.#keepers().includes(run.task)) {
      this.#kept.push({ task: run.task, from: now });
    }
    const usage = this.usage(run.tokenSha256) as GatewayUsage;
    return run.task ? { ...usage, share: this.#share(run.task, now) } : usage;
  }

  /** The task no longer keeps the pod: it does not go on to another run now. */
  release(task: string): void {
    const now = this.#now();
    for (const span of this.#kept) if (span.task === task && span.to === undefined) span.to = now;
  }

  /** What a run, by its token's hash, or the last one, used so far. */
  usage(tokenSha256?: string): GatewayUsage | undefined {
    const run = this.#find(tokenSha256);
    if (!run) return undefined;
    const now = run.end ?? this.#now();
    return {
      ...summarize(run.records, run.meter, run.start, now, run.samples),
      cost: this.#cost(run),
    };
  }

  #find(tokenSha256: string | undefined): Run | undefined {
    if (tokenSha256 === undefined) return this.#runs.at(-1);
    return this.#runs.findLast((run) => run.tokenSha256 === tokenSha256);
  }

  /** Whether a run is being served. */
  get serving(): boolean {
    return this.#runs.some((run) => run.active);
  }

  /** The runs being served, for the pod's limits. */
  get runs(): { deadline: number | undefined; lastActivity: number }[] {
    return this.#runs
      .filter((run) => run.active)
      .map((run) => ({ deadline: this.#deadline(run), lastActivity: run.lastActivity }));
  }

  /** When the first of the runs' budgets is spent, for a meter that knows in advance. */
  get deadline(): number | undefined {
    const deadlines = this.runs.flatMap((run) =>
      run.deadline === undefined ? [] : [run.deadline],
    );
    return deadlines.length > 0 ? Math.min(...deadlines) : undefined;
  }

  /**
   * When a pod's run would spend its budget, were it alone from now on: other runs only make it
   * later, so the pod checks again.
   */
  #deadline(run: Run): number | undefined {
    if (!run.active || run.meter.kind !== "time") return undefined;
    const now = this.#now();
    return now + Math.floor(((run.limit - this.#cost(run)) / run.meter.pricePerSecond) * 1000);
  }

  /**
   * Stops the runs whose budget is spent or whose agent made no request for `runIdleMs`, while
   * others go on; when none would, the pod terminates instead.
   */
  expireRuns(runIdleMs: number): void {
    const now = this.#now();
    for (const run of this.#runs.filter((one) => one.active)) {
      if (!this.#withinBudget(run)) this.#stop(run, "This run's budget is spent.");
      else if (now - run.lastActivity >= runIdleMs) {
        this.#stop(run, "This run made no request for too long.");
      }
    }
  }

  /** What a run cost so far: its share of the pod's time, or its workers' busy time. */
  #cost(run: Run): number {
    const now = this.#now();
    if (run.meter.kind === "busy") {
      return meterCost(run.meter, run.start, run.records, run.end ?? now, run.samples);
    }
    return this.#shares(now).runs.get(run.id) ?? 0;
  }

  /** The pod's split among its runs and the tasks that keep it. */
  #shares(now: number): ReturnType<typeof podShares> {
    const spans: PodRunSpan[] = [];
    for (const run of this.#runs) {
      if (run.meter.kind !== "time") continue;
      spans.push({
        id: run.id,
        start: run.start,
        end: run.end,
        pricePerSecond: run.meter.pricePerSecond,
      });
    }
    return podShares(spans, this.#kept, now, spans.at(-1)?.pricePerSecond ?? 0);
  }

  #share(task: string, now: number): PodShare {
    const shares = this.#shares(now);
    let taskCost = shares.kept.get(task) ?? 0;
    for (const run of this.#runs) {
      if (run.task === task) taskCost += shares.runs.get(run.id) ?? 0;
    }
    const tasks = (runs: readonly Run[]) => [
      ...new Set(runs.map((run) => run.task).filter((one) => one !== "")),
    ];
    return {
      taskCost,
      tasks: tasks(this.#runs),
      active: tasks(this.#runs.filter((run) => run.active)),
      keepers: this.#keepers(),
    };
  }

  #keepers(): string[] {
    return [...new Set(this.#kept.filter((span) => span.to === undefined).map((s) => s.task))];
  }

  /** Whether a run may still spend. */
  #withinBudget(run: Run): boolean {
    return this.#cost(run) < run.limit;
  }

  status(): Record<string, unknown> {
    const active = this.#runs.filter((run) => run.active);
    return {
      version: GATEWAY_VERSION,
      ready: this.ready,
      contextLength: this.contextLength,
      serving: this.serving,
      deadline: this.deadline,
      lastActivity: this.lastActivity,
      group: this.group,
      tasks: [...new Set(this.#runs.map((run) => run.task).filter((task) => task !== ""))],
      active: [...new Set(active.map((run) => run.task).filter((task) => task !== ""))],
      keepers: this.#keepers(),
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

    // Each token opens only its own run, the last one it was given to.
    const token = bearer(request);
    const run = this.#runs.findLast((one) => matches(token, one.tokenSha256));
    if (run?.stopped) return send(response, 503, error(run.stopped, "run_stopped"));
    if (!run?.active) return send(response, 401, error("Invalid token."));
    this.lastActivity = run.lastActivity = this.#now();
    if (!this.#withinBudget(run)) {
      return send(response, 402, error("This run's budget is spent.", "budget_exceeded"));
    }
    if (!this.ready) return send(response, 503, error("The model is not loaded yet."));
    await this.#forward(run, request, response, path);
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
    if (route === "POST /admin/end") {
      // Clients from before several runs at once send no fields, and end the last run.
      const body = (parseJson(await readBody(request, 64 * 1024)) ?? {}) as Record<string, unknown>;
      const tokenSha256 = typeof body.tokenSha256 === "string" ? body.tokenSha256 : undefined;
      return send(response, 200, this.endRun({ tokenSha256, keep: body.keep === true }) ?? null);
    }
    if (route === "POST /admin/release") {
      const body = (parseJson(await readBody(request, 64 * 1024)) ?? {}) as Record<string, unknown>;
      if (typeof body.task !== "string" || !TASK.test(body.task)) {
        return send(response, 400, error("Invalid task."));
      }
      this.release(body.task);
      return send(response, 200, this.status());
    }
    return send(response, 404, error("Not found."));
  }
  async #forward(
    run: Run,
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<void> {
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
    run.records.push(record);
    const abort = new AbortController();
    run.open.add(abort);
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
      const reason: unknown = abort.signal.reason;
      const stopped = reason instanceof RunStopped ? reason : undefined;
      if (abort.signal.aborted && !stopped) return;
      if (!stopped) {
        this.#log(
          `The engine failed: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
      }
      const body = stopped
        ? error(stopped.message, "run_stopped")
        : error("The engine did not answer.");
      if (!response.headersSent) send(response, stopped ? 503 : 502, body);
      else response.end(`data: ${JSON.stringify(body)}\n\n`);
    } finally {
      run.open.delete(abort);
      clearInterval(keepAlive);
      this.lastActivity = run.lastActivity = this.#now();
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
  const { tokenSha256, limit, start, pricePerSecond, idleSeconds, task, group } = body as Record<
    string,
    unknown
  >;
  const positive = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  if (typeof tokenSha256 !== "string" || !/^[0-9a-f]{64}$/.test(tokenSha256)) return undefined;
  if (!positive(limit) || !positive(start) || !positive(pricePerSecond)) return undefined;
  if (task !== undefined && (typeof task !== "string" || !TASK.test(task))) return undefined;
  if (group !== undefined && (typeof group !== "string" || !GROUP.test(group))) return undefined;
  const named = { ...(task ? { task } : {}), ...(group ? { group } : {}) };
  if (idleSeconds === undefined) {
    return { tokenSha256, limit, start, meter: { kind: "time", pricePerSecond }, ...named };
  }
  if (typeof idleSeconds !== "number" || !Number.isFinite(idleSeconds) || idleSeconds < 0) {
    return undefined;
  }
  return {
    tokenSha256,
    limit,
    start,
    meter: { kind: "busy", pricePerSecond, idleMs: idleSeconds * 1000 },
    ...named,
  };
}
