import { randomUUID } from "node:crypto";
import { type FakeRequest, type FakeServer, HttpError, json, unknownFields } from "../http.ts";
import type { Span } from "./billing.ts";
import { problem } from "./catalog.ts";

/**
 * The fake's Serverless endpoints: `GET /v2/serverless[/{id}]` on the REST API, and each
 * endpoint's job queue under `/v2/{id}/` on the origin that stands for `https://api.runpod.ai`
 * (docs/web/runpod/operation-reference.md). A job goes to a `QueueBackend`, which yields the
 * worker's outputs: the deterministic `echoBackend` by default, an OpenAI-compatible server (the
 * scripted model or the tee) with `openAiBackend`.
 */

/** An endpoint as a scenario declares it. */
export interface EndpointSetup {
  id: string;
  name?: string;
  type?: "QUEUE" | "LOAD_BALANCER";
  workers?: { min?: number; max?: number; idleTimeout?: number };
  gpu?: { pools?: string[]; excludedTypes?: string[]; count?: number };
  env?: Record<string, string>;
  flashboot?: "OFF" | "FLASHBOOT" | "PRIORITY_FLASHBOOT";
  /** USD per hour for one running worker; else the dearest GPU of its pools, times its count. */
  pricePerHour?: number;
}

/** The worker counts `/health` reports, by state. */
export interface Workers {
  idle: number;
  initializing: number;
  ready: number;
  running: number;
  throttled: number;
  unhealthy: number;
}

export type JobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";
const FINAL = new Set<JobStatus>(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

/** What a backend gets of a job. */
export interface QueueJob {
  id: string;
  endpoint: string;
  /** The request's `input`, as sent. */
  input: unknown;
  /** The endpoint's environment, such as the vLLM worker's `MODEL_NAME`. */
  env: Record<string, string>;
}

/** The worker behind the queue: it yields the job's outputs, and throws to fail it. */
export interface QueueBackend {
  run(job: QueueJob, signal: AbortSignal): AsyncIterable<unknown>;
}

export interface Job extends QueueJob {
  policy: unknown;
  status: JobStatus;
  submittedAt: number;
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  outputs: unknown[];
  /** Outputs `/stream` has not given yet. */
  unread: unknown[];
  error?: string | undefined;
  /** Whether its run is billed from the jobs, rather than by workers a scenario set. */
  autoBilled: boolean;
  controller: AbortController;
}

interface EndpointState {
  setup: EndpointSetup;
  createdAt: number;
  /** Worker counts a scenario set; undefined while they follow the jobs. */
  workers: Partial<Workers> | undefined;
  /** Spans billed by workers a scenario set, at one worker's price each. */
  manual: { start: number; end?: number | undefined; running: number }[];
}

export interface QueueOptions {
  now: () => number;
  authorize: (request: FakeRequest) => void;
  /** USD per hour for one GPU of a pool's dearest type that `gpu` admits. */
  poolPrice: (gpu: EndpointSetup["gpu"]) => number | undefined;
}

export class ServerlessQueues {
  readonly jobs = new Map<string, Job>();
  backend: QueueBackend = echoBackend;
  /** Endpoints whose workers take no job: the jobs wait `IN_QUEUE`. `true` holds every one. */
  hold: boolean | string[] = false;
  readonly #endpoints = new Map<string, EndpointState>();
  readonly #options: QueueOptions;

  constructor(options: QueueOptions) {
    this.#options = options;
  }

  /** Replaces the endpoints; their jobs go with them. */
  setEndpoints(setups: readonly EndpointSetup[]): void {
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
    this.#endpoints.clear();
    for (const setup of setups) this.putEndpoint(setup);
  }

  putEndpoint(setup: EndpointSetup): void {
    const previous = this.#endpoints.get(setup.id);
    this.#endpoints.set(setup.id, {
      setup,
      createdAt: previous?.createdAt ?? this.#options.now(),
      workers: previous?.workers,
      manual: previous?.manual ?? [],
    });
    this.pump();
  }

  endpoints(): EndpointSetup[] {
    return [...this.#endpoints.values()].map(({ setup }) => setup);
  }

  /** Sets the workers `/health` reports, and bills `running` of them; undefined follows the jobs. */
  setWorkers(id: string, workers: Partial<Workers> | undefined): void {
    const endpoint = this.#endpoint(id);
    const now = this.#options.now();
    const open = endpoint.manual.at(-1);
    if (open && open.end === undefined) open.end = now;
    endpoint.workers = workers ? { ...workers } : undefined;
    if (workers?.running) endpoint.manual.push({ start: now, running: workers.running });
  }

  /** Starts the queued jobs that a worker may take now. */
  pump(): void {
    for (const job of this.jobs.values()) {
      if (job.status === "IN_QUEUE" && !this.#held(job.endpoint)) this.#start(job);
    }
  }

  /** What one running worker costs, in USD per hour; 0 when nothing gives a price. */
  pricePerHour(id: string): number {
    const { setup } = this.#endpoint(id);
    if (setup.pricePerHour !== undefined) return setup.pricePerHour;
    return (this.#options.poolPrice(setup.gpu) ?? 0) * (setup.gpu?.count ?? 1);
  }

  /** The spans an endpoint was billed: its jobs' runs and idle timeouts, and set workers. */
  spans(id: string): Span[] {
    const endpoint = this.#endpoint(id);
    const perHour = this.pricePerHour(id);
    const idleMs = (endpoint.setup.workers?.idleTimeout ?? 5) * 1000;
    const runs = [...this.jobs.values()]
      .filter((job) => job.endpoint === id && job.autoBilled && job.startedAt !== undefined)
      .map((job) => ({
        start: job.startedAt as number,
        end: job.endedAt === undefined ? undefined : job.endedAt + idleMs,
      }))
      .sort((a, b) => a.start - b.start);
    const spans: Span[] = [];
    for (const run of runs) {
      const last = spans.at(-1);
      if (last && (last.end === undefined || run.start <= last.end)) {
        last.end =
          last.end === undefined || run.end === undefined ? undefined : Math.max(last.end, run.end);
      } else spans.push({ ...run, perHour });
    }
    for (const span of endpoint.manual) {
      spans.push({ start: span.start, end: span.end, perHour: perHour * span.running });
    }
    return spans;
  }

  /** Every endpoint's ID. */
  ids(): string[] {
    return [...this.#endpoints.keys()];
  }

  /** The REST API's `Endpoint`, as get-a-serverless-endpoint.md lists its fields. */
  endpointJson(id: string, origin: string): Record<string, unknown> {
    const { setup, createdAt } = this.#endpoint(id);
    const base = `${origin}/v2/${encodeURIComponent(id)}`;
    return {
      id,
      name: setup.name ?? id,
      type: setup.type ?? "QUEUE",
      requestUrls: {
        run: `${base}/run`,
        runSync: `${base}/runsync`,
        status: `${base}/status/{job_id}`,
        stream: `${base}/stream/{job_id}`,
        cancel: `${base}/cancel/{job_id}`,
        retry: `${base}/retry/{job_id}`,
        purgeQueue: `${base}/purge-queue`,
        health: `${base}/health`,
      },
      image: "runpod/worker-v1-vllm",
      args: "",
      disk: 20,
      ports: [],
      env: { ...(setup.env ?? {}) },
      registry: null,
      gpu: {
        pools: setup.gpu?.pools ?? [],
        ...(setup.gpu?.excludedTypes ? { excludedTypes: setup.gpu.excludedTypes } : {}),
        count: setup.gpu?.count ?? 1,
        allowedCudaVersions: [],
        minCudaVersion: null,
      },
      workers: {
        min: setup.workers?.min ?? 0,
        max: setup.workers?.max ?? 1,
        idleTimeout: setup.workers?.idleTimeout ?? 5,
      },
      scaling: { type: "QUEUE_DELAY", queueDelay: 4 },
      dataCenterIds: ["E2E-1"],
      networkVolumes: [],
      mounts: { network: [], global: [] },
      timeout: 600_000,
      flashboot: setup.flashboot ?? "OFF",
      createdAt: new Date(createdAt).toISOString().replace(/\.\d+Z$/, "Z"),
    };
  }

  /** The queue's routes; `/v2/{endpoint}/...` after the REST API's, which take precedence. */
  routes(server: FakeServer): void {
    const authorized = (request: FakeRequest) => {
      this.#options.authorize(request);
      return this.#endpoint(request.params.endpoint ?? "");
    };
    server.route("POST", "/v2/{endpoint}/run", (request) => {
      const endpoint = authorized(request);
      const body = request.json() as { input?: unknown; policy?: unknown } | null;
      if (typeof body !== "object" || body === null || body.input === undefined) {
        throw new HttpError(400, { error: "The request needs an input." });
      }
      const job: Job = {
        id: `${randomUUID()}-e2e`,
        endpoint: endpoint.setup.id,
        input: body.input,
        env: { ...(endpoint.setup.env ?? {}) },
        policy: body.policy,
        status: "IN_QUEUE",
        submittedAt: this.#options.now(),
        outputs: [],
        unread: [],
        autoBilled: false,
        controller: new AbortController(),
      };
      this.jobs.set(job.id, job);
      if (!this.#held(job.endpoint)) this.#start(job);
      return json({ id: job.id, status: "IN_QUEUE" });
    });
    server.route("GET", "/v2/{endpoint}/status/{job}", (request) => {
      const job = this.#job(authorized(request), request.params.job ?? "");
      const now = this.#options.now();
      return json({
        id: job.id,
        status: job.status,
        delayTime: (job.startedAt ?? now) - job.submittedAt,
        ...(job.startedAt === undefined
          ? {}
          : { executionTime: (job.endedAt ?? now) - job.startedAt }),
        ...(job.status === "COMPLETED"
          ? { output: job.outputs.length === 1 ? job.outputs[0] : job.outputs }
          : {}),
        ...(job.error === undefined ? {} : { error: job.error }),
      });
    });
    server.route("GET", "/v2/{endpoint}/stream/{job}", (request) => {
      const job = this.#job(authorized(request), request.params.job ?? "");
      const stream = job.unread.splice(0).map((output) => ({ output }));
      return json({
        status: job.status,
        stream,
        ...(job.error === undefined ? {} : { error: job.error }),
      });
    });
    server.route("POST", "/v2/{endpoint}/cancel/{job}", (request) => {
      const job = this.#job(authorized(request), request.params.job ?? "");
      if (!FINAL.has(job.status)) {
        job.status = "CANCELLED";
        job.endedAt = this.#options.now();
        job.controller.abort();
      }
      return json({ id: job.id, status: job.status });
    });
    server.route("GET", "/v2/{endpoint}/health", (request) => {
      const endpoint = authorized(request);
      const id = endpoint.setup.id;
      const mine = [...this.jobs.values()].filter((job) => job.endpoint === id);
      const count = (status: JobStatus) => mine.filter((job) => job.status === status).length;
      return json({
        jobs: {
          completed: count("COMPLETED"),
          failed: count("FAILED") + count("TIMED_OUT"),
          inProgress: count("IN_PROGRESS"),
          inQueue: count("IN_QUEUE"),
          retried: 0,
        },
        workers: this.#workers(endpoint),
      });
    });
  }

  /** The workers a scenario set, or those the jobs imply: one runs while a job runs, and for the idle timeout after. */
  #workers(endpoint: EndpointState): Workers {
    const none: Workers = {
      idle: 0,
      initializing: 0,
      ready: 0,
      running: 0,
      throttled: 0,
      unhealthy: 0,
    };
    if (endpoint.workers) return { ...none, ...endpoint.workers };
    const now = this.#options.now();
    const running = this.spans(endpoint.setup.id).some(
      (span) => span.start <= now && (span.end === undefined || span.end > now),
    )
      ? 1
      : 0;
    const max = endpoint.setup.workers?.max ?? 1;
    return { ...none, running, idle: Math.max(0, max - running) };
  }

  #held(id: string): boolean {
    const max = this.#endpoints.get(id)?.setup.workers?.max ?? 1;
    return max === 0 || this.hold === true || (Array.isArray(this.hold) && this.hold.includes(id));
  }

  #start(job: Job): void {
    const endpoint = this.#endpoints.get(job.endpoint);
    job.status = "IN_PROGRESS";
    job.startedAt = this.#options.now();
    job.autoBilled = endpoint?.workers === undefined;
    const signal = job.controller.signal;
    const run = async () => {
      for await (const output of this.backend.run(
        { id: job.id, endpoint: job.endpoint, input: job.input, env: job.env },
        signal,
      )) {
        if (signal.aborted) return;
        job.outputs.push(output);
        job.unread.push(output);
      }
    };
    run().then(
      () => this.#end(job, "COMPLETED"),
      (error: unknown) =>
        this.#end(job, "FAILED", error instanceof Error ? error.message : String(error)),
    );
  }

  #end(job: Job, status: JobStatus, error?: string): void {
    if (FINAL.has(job.status)) return;
    job.status = status;
    job.endedAt = this.#options.now();
    if (error !== undefined) job.error = error;
  }

  #endpoint(id: string): EndpointState {
    const endpoint = this.#endpoints.get(id);
    if (!endpoint) throw problem(404, "endpoint not found");
    return endpoint;
  }

  #job(endpoint: EndpointState, id: string): Job {
    const job = this.jobs.get(id);
    if (!job || job.endpoint !== endpoint.setup.id)
      throw new HttpError(404, { error: "job not found" });
    return job;
  }
}

/** An endpoint from the control API's JSON; a 400 when a field has the wrong type. */
export function endpointOf(value: unknown): EndpointSetup {
  const setup = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const object = (field: unknown) =>
    field === undefined || (typeof field === "object" && field !== null && !Array.isArray(field));
  const unknown =
    unknownFields(setup, "", ENDPOINT_FIELDS) ??
    (object(setup.workers)
      ? unknownFields(setup.workers, "workers.", WORKERS_FIELDS)
      : undefined) ??
    (object(setup.gpu) ? unknownFields(setup.gpu, "gpu.", GPU_FIELDS) : undefined);
  if (unknown) {
    throw new HttpError(400, {
      message: `An endpoint has no field ${unknown}; it has id, and may have name, type, workers {min, max, idleTimeout}, gpu {pools, excludedTypes, count}, env, flashboot and pricePerHour.`,
    });
  }
  const env = setup.env as Record<string, unknown> | undefined;
  if (
    typeof setup.id !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(setup.id) ||
    !object(setup.workers) ||
    !object(setup.gpu) ||
    !object(env) ||
    Object.values(env ?? {}).some((item) => typeof item !== "string") ||
    (setup.pricePerHour !== undefined && typeof setup.pricePerHour !== "number")
  ) {
    throw new HttpError(400, {
      message:
        "An endpoint has id (letters, digits, - and _), and may have name, type, workers {min, max, idleTimeout}, gpu {pools, excludedTypes, count}, env, flashboot and pricePerHour.",
    });
  }
  return setup as unknown as EndpointSetup;
}

const ENDPOINT_FIELDS = [
  "id",
  "name",
  "type",
  "workers",
  "gpu",
  "env",
  "flashboot",
  "pricePerHour",
];
const WORKERS_FIELDS = ["min", "max", "idleTimeout"];
const GPU_FIELDS = ["pools", "excludedTypes", "count"];

/** Worker counts from the control API's JSON. */
export function workersOf(value: unknown): Partial<Workers> {
  const workers = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const names = ["idle", "initializing", "ready", "running", "throttled", "unhealthy"];
  if (
    Object.entries(workers).some(
      ([name, count]) => !names.includes(name) || !Number.isInteger(count) || (count as number) < 0,
    )
  ) {
    throw new HttpError(400, { message: `Workers are counts, by state: ${names.join(", ")}.` });
  }
  return workers as Partial<Workers>;
}

/**
 * The default worker: deterministic, without a model. An OpenAI-compatible request, as the vLLM
 * worker takes it (`openai_route` and `openai_input`), gets a reply that echoes the last message,
 * streamed as Server-Sent Events when `stream` is set, with `usage` counting words as tokens.
 * Any other input comes back as `{ "echo": input }`.
 */
export const echoBackend: QueueBackend = {
  async *run(job) {
    const input = (job.input ?? {}) as { openai_route?: unknown; openai_input?: unknown };
    const model = job.env.OPENAI_SERVED_MODEL_NAME_OVERRIDE ?? job.env.MODEL_NAME ?? "e2e-model";
    if (input.openai_route === "/v1/models") {
      yield { object: "list", data: [{ id: model, object: "model", owned_by: "e2e" }] };
      return;
    }
    if (input.openai_route !== "/v1/chat/completions") {
      yield { echo: job.input };
      return;
    }
    const request = (input.openai_input ?? {}) as {
      messages?: { content?: unknown }[];
      stream?: unknown;
    };
    const messages = request.messages ?? [];
    const last = messages.at(-1)?.content;
    const content = `echo: ${typeof last === "string" ? last : JSON.stringify(last ?? "")}`;
    const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
    const prompt = messages.reduce(
      (total, message) =>
        total +
        words(typeof message.content === "string" ? message.content : JSON.stringify(message)),
      0,
    );
    const usage = {
      prompt_tokens: prompt,
      completion_tokens: words(content),
      total_tokens: prompt + words(content),
    };
    const id = `chatcmpl-${job.id}`;
    const created = 0;
    if (request.stream !== true) {
      yield {
        id,
        object: "chat.completion",
        created,
        model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage,
      };
      return;
    }
    const chunk = (delta: unknown, finish: string | null, extra = {}) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
    yield chunk({ role: "assistant", content }, null);
    yield chunk({}, "stop", { usage });
    yield "data: [DONE]\n\n";
  },
};

/**
 * A worker that forwards each OpenAI-compatible job to `base` (such as the scripted model's or the
 * tee's `/v1`-less origin), as the vLLM worker does to its engine: each Server-Sent Event of a
 * streamed answer is one output, and any other answer is one JSON output; an error status yields
 * the worker's `{ "error": ... }`.
 */
export function openAiBackend(base: string, fetchFn: typeof fetch = fetch): QueueBackend {
  return {
    async *run(job, signal) {
      const input = (job.input ?? {}) as { openai_route?: unknown; openai_input?: unknown };
      if (typeof input.openai_route !== "string") {
        throw new Error("The job has no openai_route.");
      }
      const response = await fetchFn(`${base}${input.openai_route}`, {
        method: input.openai_input === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: input.openai_input === undefined ? undefined : JSON.stringify(input.openai_input),
        signal,
      });
      if (!response.ok) {
        yield { error: { status: response.status, message: await response.text() } };
        return;
      }
      if (!(response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
        yield await response.json();
        return;
      }
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffered += decoder.decode(bytes, { stream: true }).replaceAll("\r\n", "\n");
        let end = buffered.indexOf("\n\n");
        while (end >= 0) {
          yield buffered.slice(0, end + 2);
          buffered = buffered.slice(end + 2);
          end = buffered.indexOf("\n\n");
        }
      }
      if (buffered.trim() !== "") yield buffered;
    },
  };
}
