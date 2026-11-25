/**
 * A prototype supervisor (E2 of docs/plans/2026-10-30-investigate-multi-service-pods.md): one
 * HTTP server in front of several services on several engines, in one container. It loads a
 * secondary service on its first request, unloads it when idle, evicts the least recently used
 * idle service when a load does not fit the memory budget, holds streamed requests with SSE
 * comments while their service loads, swaps the primary out for a generator and back, serves
 * generation as submit and poll, and measures each run's occupancy of each service.
 *
 * Not a gateway: no tokens, budgets or usage. A run is named by the `X-Codeman-Run` header.
 * Imported by prove.ts, which runs it.
 */
import { randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { EngineAdapter, Footprint, ServiceSpec, ServiceState } from "./services.ts";

export interface SupervisorOptions {
  services: ServiceSpec[];
  adapters: EngineAdapter[];
  /** The memory the services may hold together, in bytes: stands in for the GPU's. */
  budgetBytes: number;
  /** Where generations are written; their content is served from there, never inlined. */
  outputs: string;
  /** How often a held streamed request gets an SSE comment. The gateway sends one per 20 s. */
  keepAliveMs?: number;
  log?: (message: string) => void;
}

/** A service as the supervisor keeps it. */
interface Service {
  spec: ServiceSpec;
  adapter: EngineAdapter;
  state: ServiceState;
  /** The load or unload in progress. */
  transition?: Promise<void> | undefined;
  failure?: string | undefined;
  /** Requests being served now; a service with any is never evicted. */
  inFlight: number;
  lastUsed: number;
  /** What it held when last measured, and the most since it loaded. */
  footprint?: Footprint | undefined;
  peakBytes: number;
  /** The most it held in any load: what it needs to load again. */
  knownPeak: number;
  /** Generations submitted and not finished. */
  queue: Job[];
  working: boolean;
  /** Timings of its loads and unloads, in milliseconds. */
  loads: number[];
  unloads: number[];
}

/** A generation: submitted, then polled, then its content fetched. */
interface Job {
  id: string;
  run: string;
  service: string;
  status: "queued" | "running" | "done" | "failed";
  prompt: string;
  steps: number;
  size: number;
  submittedAt: number;
  startedAt?: number | undefined;
  finishedAt?: number | undefined;
  error?: string | undefined;
  path: string;
}

/** One run's use of one service. */
interface Occupancy {
  /** Its requests in flight on the service now, and since when the service has been busy for it. */
  open: number;
  since: number;
  busyMs: number;
  /** Busy time times the service's memory: the run's share of the GPU, for decision 5. */
  byteMs: number;
  /** Time its requests waited for the service to load or for memory. */
  waitMs: number;
  requests: number;
}

class ServiceFailed extends Error {}

export class Supervisor {
  readonly #options: SupervisorOptions;
  readonly #services = new Map<string, Service>();
  readonly #jobs = new Map<string, Job>();
  readonly #occupancy = new Map<string, Map<string, Occupancy>>();
  /** Memory decisions, loads and unloads happen one at a time. */
  #lock: Promise<void> = Promise.resolve();
  #waiters: (() => void)[] = [];
  #timer: NodeJS.Timeout | undefined;
  #server: Server | undefined;
  /** Every change of state, with its time, for the proofs. */
  readonly events: { at: number; service: string; event: string }[] = [];

  constructor(options: SupervisorOptions) {
    this.#options = options;
    for (const spec of options.services) {
      const adapter = options.adapters.find((one) => one.family === spec.family);
      if (!adapter) throw new Error(`No adapter for ${spec.family}.`);
      this.#services.set(spec.name, {
        spec,
        adapter,
        state: "unloaded",
        inFlight: 0,
        lastUsed: 0,
        peakBytes: 0,
        knownPeak: 0,
        queue: [],
        working: false,
        loads: [],
        unloads: [],
      });
    }
  }

  /** Starts the engines and loads the primary service: the pod is healthy once it serves. */
  async start(): Promise<void> {
    const families = new Set<string>(this.#options.services.map((spec) => spec.family));
    for (const adapter of this.#options.adapters) {
      if (families.has(adapter.family)) await adapter.start();
    }
    const primary = this.#primary();
    if (primary) await this.ensure(primary.spec.name);
    this.#timer = setInterval(() => void this.#tick(), 500);
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#server?.close();
    for (const adapter of this.#options.adapters) await adapter.stop();
  }

  service(name: string): Readonly<Service> {
    const service = this.#services.get(name);
    if (!service) throw new Error(`No service ${name}.`);
    return service;
  }

  /** The memory the loaded and loading services hold, in bytes. */
  used(except?: Service): number {
    let used = 0;
    for (const service of this.#services.values()) {
      if (service === except) continue;
      if (service.state !== "unloaded" && service.state !== "failed") used += this.#size(service);
    }
    return used;
  }

  /** Loads a service, making room for it, and waits until it serves. */
  async ensure(name: string, signal?: AbortSignal): Promise<void> {
    await this.#acquire(this.service(name) as Service, undefined, signal);
  }

  /** Unloads a service now if it is idle, as an operator would. */
  async unload(name: string): Promise<void> {
    const service = this.service(name) as Service;
    await this.#exclusive(async () => {
      if (service.state !== "loaded" || service.inFlight > 0 || service.queue.length > 0) return;
      this.#reserve(service);
      await this.#unload(service);
    });
  }

  /**
   * Waits until the service serves, then counts a request in flight for `run`; the returned
   * function ends it. A service that does not fit waits for memory to be released.
   */
  async #acquire(
    service: Service,
    run: string | undefined,
    signal?: AbortSignal,
  ): Promise<() => void> {
    const asked = Date.now();
    for (;;) {
      if (signal?.aborted) throw new Error("The client left.");
      if (service.state === "failed") throw new ServiceFailed(service.failure);
      if (service.state === "loaded") {
        // No await between the check and the count: an eviction sees it.
        service.lastUsed = Date.now();
        if (run === undefined) return () => {};
        service.inFlight += 1;
        const occupancy = this.#open(run, service, Date.now() - asked);
        return () => this.#release(service, occupancy);
      }
      if (service.transition) {
        await service.transition.catch(() => {});
        continue;
      }
      // Registered before the attempt, so a release during it is not missed.
      const changed = this.#changed();
      const started = await this.#exclusive(() => this.#load(service));
      if (!started) await Promise.race([changed, aborted(signal)]);
    }
  }

  /**
   * Loads an unloaded service, evicting least recently used idle services until it fits.
   * Returns false when it cannot fit until a busy service is released. Runs under the lock.
   */
  async #load(service: Service): Promise<boolean> {
    if (service.state !== "unloaded") return true;
    const need = this.#need(service);
    if (need > this.#options.budgetBytes) {
      service.state = "failed";
      service.failure = `it needs ${need} bytes, more than the budget of ${this.#options.budgetBytes}`;
      this.#event(service, `failed: ${service.failure}`);
      this.#notify();
      return true;
    }
    while (this.used(service) + need > this.#options.budgetBytes) {
      const victim = this.#victim(service, need);
      if (!victim) {
        this.#event(service, `waits for memory: needs ${need}, ${this.used()} used`);
        return false;
      }
      this.#event(victim, `evicted for ${service.spec.name}`);
      await this.#unload(victim);
    }
    const started = Date.now();
    service.state = "loading";
    this.#event(service, "loading");
    service.transition = service.adapter.load(service.spec);
    try {
      await service.transition;
      service.loads.push(Date.now() - started);
      service.state = "loaded";
      service.lastUsed = Date.now();
      service.peakBytes = 0;
      await this.#measure(service);
      this.#event(service, `loaded in ${Date.now() - started} ms`);
    } catch (error) {
      // Only this service fails: the others keep serving.
      service.state = "failed";
      service.failure = error instanceof Error ? error.message : String(error);
      this.#event(service, `failed: ${service.failure}`);
    } finally {
      service.transition = undefined;
      this.#notify();
    }
    return true;
  }

  /** Unloads a service. Runs under the lock. */
  async #unload(service: Service): Promise<void> {
    const started = Date.now();
    service.state = "unloading";
    service.transition = service.adapter.unload(service.spec);
    try {
      await service.transition;
    } finally {
      service.state = "unloaded";
      service.transition = undefined;
      service.footprint = undefined;
      service.unloads.push(Date.now() - started);
      this.#event(service, `unloaded in ${Date.now() - started} ms`);
      this.#notify();
    }
  }

  /** What a service needs to load: its estimate, or the most it held before. */
  #need(service: Service): number {
    return Math.max(service.spec.estimateBytes, service.knownPeak);
  }

  /**
   * The service to evict for `service`: the least recently used idle secondary service. The
   * primary is evicted only for a service that cannot fit beside it at all: a swap (decision 2).
   */
  #victim(service: Service, need: number): Service | undefined {
    const primary = this.#primary();
    const swap = primary !== undefined && this.#size(primary) + need > this.#options.budgetBytes;
    const idle = [...this.#services.values()].filter(
      (one) =>
        one !== service &&
        one.state === "loaded" &&
        one.inFlight === 0 &&
        one.queue.length === 0 &&
        (one !== primary || swap),
    );
    idle.sort(
      (a, b) =>
        Number(a.spec.primary ?? false) - Number(b.spec.primary ?? false) ||
        a.lastUsed - b.lastUsed,
    );
    const victim = idle[0];
    if (victim) this.#reserve(victim);
    return victim;
  }

  /** What a service holds, or would hold once loaded. */
  #size(service: Service): number {
    if (service.state === "loaded" || service.state === "unloading") {
      return Math.max(service.peakBytes, service.footprint?.bytes ?? service.spec.estimateBytes);
    }
    return this.#need(service);
  }

  /** Marks the victim as leaving at once, so no request counts itself on it meanwhile. */
  #reserve(victim: Service): void {
    victim.state = "unloading";
  }

  #release(service: Service, occupancy: Occupancy): void {
    service.inFlight -= 1;
    service.lastUsed = Date.now();
    occupancy.open -= 1;
    if (occupancy.open === 0) {
      const busy = Date.now() - occupancy.since;
      occupancy.busyMs += busy;
      occupancy.byteMs += busy * Math.max(service.peakBytes, service.footprint?.bytes ?? 0);
    }
    this.#notify();
    this.#restorePrimary(service);
  }

  /** After a swap, the primary comes back once the secondary that took its memory is idle. */
  #restorePrimary(released: Service): void {
    const primary = this.#primary();
    if (!primary || released === primary || primary.state !== "unloaded") return;
    if (released.inFlight > 0 || released.queue.length > 0) return;
    this.#event(primary, `restoring after ${released.spec.name}`);
    void this.ensure(primary.spec.name).catch(() => {});
  }

  #open(run: string, service: Service, waited: number): Occupancy {
    const byService = this.#occupancy.get(run) ?? new Map<string, Occupancy>();
    this.#occupancy.set(run, byService);
    let occupancy = byService.get(service.spec.name);
    if (!occupancy) {
      occupancy = { open: 0, since: 0, busyMs: 0, byteMs: 0, waitMs: 0, requests: 0 };
      byService.set(service.spec.name, occupancy);
    }
    if (occupancy.open === 0) occupancy.since = Date.now();
    occupancy.open += 1;
    occupancy.requests += 1;
    occupancy.waitMs += waited;
    return occupancy;
  }

  /** Each run's seconds busy on each service, its waits, and its GB-seconds of memory. */
  occupancy(): Record<string, Record<string, Record<string, number>>> {
    const report: Record<string, Record<string, Record<string, number>>> = {};
    for (const [run, byService] of this.#occupancy) {
      report[run] = {};
      for (const [name, one] of byService) {
        const open = one.open > 0 ? Date.now() - one.since : 0;
        report[run][name] = {
          busySeconds: round((one.busyMs + open) / 1000),
          waitSeconds: round(one.waitMs / 1000),
          gbSeconds: round(one.byteMs / 1e12),
          requests: one.requests,
        };
      }
    }
    return report;
  }

  /** Unloads idle secondary services, and measures the loaded ones. */
  async #tick(): Promise<void> {
    for (const service of this.#services.values()) {
      if (service.state !== "loaded") continue;
      await this.#measure(service).catch(() => {});
      const idleMs = service.spec.idleMs;
      if (service.spec.primary || idleMs === undefined) continue;
      if (service.inFlight > 0 || service.queue.length > 0) continue;
      if (Date.now() - service.lastUsed < idleMs) continue;
      await this.#exclusive(async () => {
        if (service.state !== "loaded" || service.inFlight > 0 || service.queue.length > 0) return;
        this.#event(service, `idle for ${Date.now() - service.lastUsed} ms`);
        this.#reserve(service);
        await this.#unload(service);
      });
    }
  }

  async #measure(service: Service): Promise<void> {
    if (service.state !== "loaded") return;
    const footprint = await service.adapter.footprint(service.spec);
    if (service.state !== "loaded") return;
    service.footprint = footprint;
    service.peakBytes = Math.max(service.peakBytes, footprint.bytes);
    service.knownPeak = Math.max(service.knownPeak, footprint.bytes);
  }

  #primary(): Service | undefined {
    return [...this.#services.values()].find((service) => service.spec.primary);
  }

  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#lock.then(work);
    this.#lock = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  #changed(): Promise<void> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #notify(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const resolve of waiters) resolve();
  }

  #event(service: Service, event: string): void {
    this.events.push({ at: Date.now(), service: service.spec.name, event });
    this.#options.log?.(`${service.spec.name}: ${event}`);
  }

  status(): Record<string, unknown> {
    return {
      budgetBytes: this.#options.budgetBytes,
      usedBytes: this.used(),
      services: [...this.#services.values()].map((service) => ({
        name: service.spec.name,
        family: service.spec.family,
        model: service.spec.model,
        primary: service.spec.primary ?? false,
        state: service.state,
        failure: service.failure,
        inFlight: service.inFlight,
        queued: service.queue.length,
        routes: service.adapter.routes(service.spec),
        footprint: service.footprint,
        peakBytes: service.peakBytes,
        loadsMs: service.loads,
        unloadsMs: service.unloads,
      })),
    };
  }

  // HTTP.

  async listen(port = 0, host = "127.0.0.1"): Promise<string> {
    const server = createServer((request, response) => {
      this.#handle(request, response).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!response.headersSent) send(response, 500, { error: { message } });
        else response.end();
      });
    });
    this.#server = server;
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    return `http://${host}:${(server.address() as AddressInfo).port}`;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const run = String(request.headers["x-codeman-run"] ?? "anonymous");
    if (request.method === "GET" && path === "/health") {
      const primary = this.#primary();
      return send(response, 200, { ready: primary?.state === "loaded", status: this.status() });
    }
    if (request.method === "GET" && path === "/admin/status") {
      return send(response, 200, this.status());
    }
    if (request.method === "GET" && path === "/admin/occupancy") {
      return send(response, 200, this.occupancy());
    }
    if (request.method === "POST" && path === "/v1/chat/completions") {
      return this.#chat(run, request, response);
    }
    if (request.method === "POST" && path === "/v1/generations") {
      return this.#submit(run, request, response);
    }
    const job = /^\/v1\/generations\/([\w-]{36})(\/content)?$/.exec(path);
    if (request.method === "GET" && job) {
      const found = this.#jobs.get(job[1] as string);
      // A run sees only its own generations.
      if (!found || found.run !== run) return send(response, 404, error("No such generation."));
      if (!job[2]) return send(response, 200, publicJob(found));
      if (found.status !== "done") return send(response, 409, error(`It is ${found.status}.`));
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": statSync(found.path).size,
      });
      createReadStream(found.path).pipe(response);
      return;
    }
    return send(response, 404, error("Not found."));
  }

  /** A chat request, held with SSE comments while its service loads or swaps back. */
  async #chat(run: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    const service = this.#services.get(String(body.model));
    if (service?.spec.kind !== "chat") {
      return send(response, 404, error(`No chat service ${String(body.model)}.`));
    }
    const stream = body.stream === true;
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });
    const holding = stream
      ? setInterval(() => {
          if (!response.headersSent) response.writeHead(200, SSE_HEADERS);
          response.write(`: codeman: ${service.spec.name} is ${service.state}\n\n`);
        }, this.#options.keepAliveMs ?? 20_000)
      : undefined;
    let release: (() => void) | undefined;
    try {
      release = await this.#acquire(service, run, abort.signal);
      clearInterval(holding);
      const upstream = await service.adapter.forward(service.spec, {
        method: "POST",
        path: "/v1/chat/completions",
        body: JSON.stringify({ ...body, model: service.spec.model }),
        signal: abort.signal,
      });
      if (!response.headersSent) {
        response.writeHead(upstream.status, {
          "Content-Type": upstream.contentType ?? "application/json",
        });
      }
      for await (const chunk of upstream.body) response.write(chunk);
      response.end();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      const status = failure instanceof ServiceFailed ? 503 : 502;
      const text = `${service.spec.name} cannot serve: ${message}`;
      if (!response.headersSent) send(response, status, error(text));
      else response.end(`data: ${JSON.stringify(error(text))}\n\n`);
    } finally {
      clearInterval(holding);
      release?.();
    }
  }

  /** Submits a generation: answers its id at once; the work runs in the background. */
  async #submit(run: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    const service = this.#services.get(String(body.model));
    if (service?.spec.kind !== "generation") {
      return send(response, 404, error(`No generation service ${String(body.model)}.`));
    }
    if (service.state === "failed") {
      return send(response, 503, error(`${service.spec.name} failed: ${service.failure}`));
    }
    const id = randomUUID();
    const job: Job = {
      id,
      run,
      service: service.spec.name,
      status: "queued",
      prompt: String(body.prompt ?? "").slice(0, 1000),
      steps: Math.min(50, Math.max(1, Number(body.steps ?? 4) || 4)),
      size: Math.min(512, Math.max(32, Number(body.size ?? 64) || 64)),
      submittedAt: Date.now(),
      path: join(this.#options.outputs, `${id}.png`),
    };
    this.#jobs.set(id, job);
    service.queue.push(job);
    void this.#work(service);
    send(response, 202, publicJob(job));
  }

  /** Runs a service's queued generations, one at a time. */
  async #work(service: Service): Promise<void> {
    if (service.working) return;
    service.working = true;
    try {
      for (let job = service.queue[0]; job; job = service.queue[0]) {
        let release: (() => void) | undefined;
        try {
          release = await this.#acquire(service, job.run);
          job.status = "running";
          job.startedAt = Date.now();
          const upstream = await service.adapter.forward(service.spec, {
            method: "POST",
            path: "/generate",
            body: JSON.stringify({
              prompt: job.prompt,
              steps: job.steps,
              size: job.size,
              out: job.path,
            }),
            signal: AbortSignal.timeout(600_000),
          });
          let text = "";
          for await (const chunk of upstream.body) text += Buffer.from(chunk).toString("utf8");
          if (upstream.status !== 200) throw new Error(text.slice(0, 300));
          await this.#measure(service);
          job.status = "done";
        } catch (failure) {
          job.status = "failed";
          job.error = failure instanceof Error ? failure.message : String(failure);
        } finally {
          job.finishedAt = Date.now();
          service.queue.shift();
          release?.();
        }
      }
    } finally {
      service.working = false;
    }
  }
}

function publicJob(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    service: job.service,
    status: job.status,
    error: job.error,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    content: job.status === "done" ? `/v1/generations/${job.id}/content` : undefined,
  };
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function aborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => signal?.addEventListener("abort", () => resolve()));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function error(message: string): { error: { message: string } } {
  return { error: { message: `Codeman supervisor: ${message}` } };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
