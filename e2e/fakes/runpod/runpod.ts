import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { type FakeRequest, FakeServer, HttpError, json } from "../http.ts";
import { billingWindow, cost, type Span, timestamp } from "./billing.ts";
import {
  type CatalogGpu,
  catalogGpuOf,
  catalogQuery,
  compareCuda,
  cudaWithin,
  defaultCatalog,
  gpuJson,
  problem,
} from "./catalog.ts";
import {
  httpLauncher,
  isFailure,
  type LaunchedPod,
  type LaunchSpec,
  noContainers,
  type PodLauncher,
} from "./launcher.ts";
import { forward } from "./proxy.ts";
import {
  type EndpointSetup,
  endpointOf,
  openAiBackend,
  type QueueBackend,
  ServerlessQueues,
  workersOf,
} from "./serverless.ts";

/**
 * A fake of Runpod for the e2e suite: the REST API v2 that src/inference/runpod.ts calls (pods,
 * the GPU catalog, billing, Serverless endpoints), each Serverless endpoint's job queue, and the
 * pods' HTTP proxy. One server stands for `https://api.runpod.io` and `https://api.runpod.ai`.
 *
 * Pods are containers a `PodLauncher` starts (launcher.ts). The proxy serves each pod's port at
 * `/pods/{id}/{port}/...`, so the e2e build's `runpodPods` template is
 * `<this fake's origin>/pods/{id}/{port}`, and the fake forwards to the URL the launcher gave.
 *
 * Shapes follow docs/web/runpod/; the fake leaves out what Codeman neither sends nor reads
 * (templates, mounts, SSH, data centers, CPU pods, pod actions, `/runsync`).
 */

type PodStatus = "PROVISIONING" | "STARTING" | "RUNNING" | "EXITED" | "ERROR" | "TERMINATED";

interface PodRecord {
  spec: LaunchSpec;
  /** The request's `ports`, as sent. */
  ports: string[];
  status: PodStatus;
  /** USD per hour, fixed when the pod is created. */
  perHour: number;
  createdAt: number;
  startedAt: number | undefined;
  terminatedAt: number | undefined;
  /** The billed spans: from its creation until it exits or is terminated. */
  spans: Span[];
  launched: LaunchedPod | undefined;
  failure: string | undefined;
  /** How many times the launcher was asked for its container. */
  launches: number;
}

export interface RunpodSetup {
  /** The API keys the fake takes, for the REST API and the queues alike; any key when empty. */
  keys?: string[];
  catalog?: CatalogGpu[];
  endpoints?: EndpointSetup[];
}

/** Faults for scenarios beyond the shared ones (an HTTP status on a route), cleared on reset. */
export interface RunpodFaults {
  /** `never`: pods stay `STARTING`, the launcher not asked; `fail`: they turn `ERROR`. */
  podStart?: "never" | "fail";
  /** The account's balance is too low: a valid pod creation answers 402, as Runpod's does. */
  lowBalance?: boolean;
  /** Endpoints whose jobs no worker takes (`true` for all): they wait `IN_QUEUE`. */
  holdQueues?: boolean | string[];
}

const POD_ACTIONS: Record<PodStatus, string[]> = {
  PROVISIONING: ["terminate"],
  STARTING: ["terminate"],
  RUNNING: ["stop", "restart", "terminate"],
  EXITED: ["start", "terminate"],
  ERROR: ["terminate"],
  TERMINATED: [],
};
const BILLED = new Set<PodStatus>(["PROVISIONING", "STARTING", "RUNNING", "ERROR"]);
const MAX_CREATE_BYTES = 102_400;

export class RunpodFake {
  readonly server = new FakeServer("runpod");
  readonly queues: ServerlessQueues;
  launcher: PodLauncher;
  readonly #now: () => number;
  readonly #pods = new Map<string, PodRecord>();
  readonly #initial: RunpodSetup;
  #keys: string[] = [];
  #catalog: CatalogGpu[] = [];
  #faults: RunpodFaults = {};

  constructor(
    setup: RunpodSetup = {},
    options: { launcher?: PodLauncher; backend?: QueueBackend; now?: () => number } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.launcher = options.launcher ?? noContainers;
    this.#initial = structuredClone(setup);
    this.queues = new ServerlessQueues({
      now: this.#now,
      authorize: (request) => this.#authorize(request),
      poolPrice: (gpu) => {
        const pools = new Set(gpu?.pools ?? []);
        const excluded = new Set(gpu?.excludedTypes ?? []);
        const prices = this.#catalog
          .filter((one) => one.pool && pools.has(one.pool) && !excluded.has(one.id))
          .map((one) => one.price.serverless ?? 0);
        return prices.length > 0 ? Math.max(...prices) : undefined;
      },
    });
    if (options.backend) this.queues.backend = options.backend;
    this.setup(setup);
    this.#routes();
    this.queues.routes(this.server);
    this.#controls();
    this.server.onReset(() => this.#reset());
  }

  /** Replaces the keys, the catalog and the endpoints; pods stay. */
  setup(setup: RunpodSetup): void {
    this.#keys = [...(setup.keys ?? [])];
    this.#catalog = (setup.catalog ?? defaultCatalog()).map((gpu) => catalogGpuOf(gpu));
    this.queues.setEndpoints((setup.endpoints ?? []).map(endpointOf));
  }

  /** Replaces the faults; `{}` clears them. */
  faults(faults: RunpodFaults): void {
    this.#faults = { ...faults };
    this.queues.hold = faults.holdQueues ?? false;
    this.queues.pump();
  }

  /** Every pod, terminated ones included, as the control API lists them. */
  pods(): Record<string, unknown>[] {
    const now = this.#now();
    return [...this.#pods.values()].map((pod) => ({
      id: pod.spec.id,
      name: pod.spec.name,
      status: pod.status,
      image: pod.spec.image,
      env: { ...pod.spec.env },
      gpu: pod.spec.gpu.id,
      cloud: pod.spec.cloud,
      ports: [...pod.ports],
      urls: Object.fromEntries(
        pod.spec.ports.map(({ port }) => [port, pod.launched?.urlForPort(port) ?? null]),
      ),
      cudaVersion: pod.spec.cudaVersion,
      pricePerHour: pod.perHour,
      cost: cost(pod.spans, 0, Number.POSITIVE_INFINITY, now),
      // Whether a span is still billed: `stopped` once the pod exited or was terminated.
      billing: pod.spans.some((span) => span.end === undefined) ? "running" : "stopped",
      createdAt: new Date(pod.createdAt).toISOString(),
      terminatedAt:
        pod.terminatedAt === undefined ? null : new Date(pod.terminatedAt).toISOString(),
      launches: pod.launches,
      failure: pod.failure ?? null,
    }));
  }

  /** A scenario's turn on a pod: `restart` its container, `exit` it, or `fail` it. */
  act(id: string, action: "restart" | "exit" | "fail"): void {
    const pod = this.#pods.get(id);
    if (!pod || pod.status === "TERMINATED") throw problem(404, "pod not found");
    if (action === "restart") {
      this.#bill(pod, true);
      pod.status = "STARTING";
      pod.launched = undefined;
      this.#terminateContainer(pod).finally(() => this.#launch(pod));
    } else if (action === "exit") {
      this.#bill(pod, false);
      pod.status = "EXITED";
      pod.launched = undefined;
      this.#terminateContainer(pod);
    } else {
      pod.status = "ERROR";
      pod.failure = "Failed by the scenario.";
      pod.launched = undefined;
      this.#terminateContainer(pod);
    }
  }

  #routes(): void {
    const server = this.server;
    server.route("POST", "/v2/pods", (request) => {
      this.#authorize(request);
      return json(this.#podJson(this.#create(request)), 201);
    });
    server.route("GET", "/v2/pods", (request) => {
      this.#authorize(request);
      const pods = [...this.#pods.values()]
        .filter((pod) => pod.status !== "TERMINATED")
        .sort((a, b) => b.createdAt - a.createdAt);
      return json(page(pods, request.query, "pods", (pod) => this.#podJson(pod)));
    });
    server.route("GET", "/v2/pods/{id}", (request) => {
      this.#authorize(request);
      return json(this.#podJson(this.#live(request.params.id ?? "")));
    });
    server.route("DELETE", "/v2/pods/{id}", (request) => {
      this.#authorize(request);
      const pod = this.#live(request.params.id ?? "");
      this.#bill(pod, false);
      pod.status = "TERMINATED";
      pod.terminatedAt = this.#now();
      pod.launched = undefined;
      this.#terminateContainer(pod);
      return { status: 204 };
    });
    server.route("GET", "/v2/catalog/gpus", (request) => {
      this.#authorize(request);
      const query = catalogQuery(request.query);
      return json({ gpus: this.#catalog.map((gpu) => gpuJson(gpu, query)) });
    });
    server.route("GET", "/v2/catalog/gpus/{id}", (request) => {
      this.#authorize(request);
      const query = catalogQuery(request.query);
      const gpu = this.#catalog.find((one) => one.id === request.params.id);
      if (!gpu) throw problem(404, "gpu type not found");
      return json(gpuJson(gpu, query));
    });
    server.route("GET", "/v2/billing/pods", (request) => {
      this.#authorize(request);
      return json(this.#podBilling(request.query));
    });
    server.route("GET", "/v2/billing", (request) => {
      this.#authorize(request);
      return json(this.#billing(request.query));
    });
    server.route("GET", "/v2/serverless", (request) => {
      this.#authorize(request);
      const ids = this.queues.ids().reverse();
      return json(
        page(ids, request.query, "endpoints", (id) => this.queues.endpointJson(id, request.origin)),
      );
    });
    server.route("GET", "/v2/serverless/{id}", (request) => {
      this.#authorize(request);
      return json(this.queues.endpointJson(request.params.id ?? "", request.origin));
    });
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      server.route(method, "/pods/{id}/{port}", (request, response) =>
        this.#proxy(request, response, ""),
      );
      server.route(method, "/pods/{id}/{port}/{rest*}", (request, response) =>
        this.#proxy(request, response, request.params.rest ?? ""),
      );
    }
  }

  #controls(): void {
    const server = this.server;
    server.control("GET", "/runpod/pods", () => json(this.pods()));
    server.control("POST", "/runpod/pods/{id}/{action}", (request) => {
      const action = request.params.action;
      if (action !== "restart" && action !== "exit" && action !== "fail") {
        throw new HttpError(400, { message: "A pod's action is restart, exit or fail." });
      }
      this.act(request.params.id ?? "", action);
      return { status: 204 };
    });
    server.control("PUT", "/runpod/setup", (request) => {
      this.setup(setupOf(request.json()));
      return { status: 204 };
    });
    server.control("GET", "/runpod/catalog", () => json(this.#catalog));
    server.control("PATCH", "/runpod/catalog/{id}", (request) => {
      const index = this.#catalog.findIndex((gpu) => gpu.id === request.params.id);
      const base = this.#catalog[index];
      if (!base) throw new HttpError(404, { message: "No such GPU type in the catalog." });
      const body = request.json() as Record<string, unknown>;
      const price = { ...base.price, ...((body?.price as object) ?? {}) };
      this.#catalog[index] = catalogGpuOf({ ...body, price, id: base.id }, base);
      return json(this.#catalog[index]);
    });
    server.control("PUT", "/runpod/endpoints/{id}", (request) => {
      const body = (request.json() ?? {}) as Record<string, unknown>;
      this.queues.putEndpoint(endpointOf({ ...body, id: request.params.id }));
      return { status: 204 };
    });
    server.control("PUT", "/runpod/endpoints/{id}/workers", (request) => {
      this.queues.setWorkers(request.params.id ?? "", workersOf(request.json()));
      return { status: 204 };
    });
    server.control("DELETE", "/runpod/endpoints/{id}/workers", (request) => {
      this.queues.setWorkers(request.params.id ?? "", undefined);
      return { status: 204 };
    });
    server.control("GET", "/runpod/jobs", () =>
      json([...this.queues.jobs.values()].map(({ controller: _, unread: __, ...job }) => job)),
    );
    server.control("GET", "/runpod/endpoints/{id}/cost", (request) => {
      const id = request.params.id ?? "";
      return json({
        cost: cost(this.queues.spans(id), 0, Number.POSITIVE_INFINITY, this.#now()),
        pricePerHour: this.queues.pricePerHour(id),
      });
    });
    server.control("PUT", "/runpod/faults", (request) => {
      this.faults(faultsOf(request.json()));
      return { status: 204 };
    });
  }

  #authorize(request: FakeRequest): void {
    if (!request.bearer) throw problem(401, "missing bearer token");
    if (this.#keys.length > 0 && !this.#keys.includes(request.bearer)) {
      throw problem(401, "invalid api key");
    }
  }

  #create(request: FakeRequest): PodRecord {
    if (request.body.length > MAX_CREATE_BYTES) {
      throw problem(413, `The request body exceeds the ${MAX_CREATE_BYTES} byte limit.`);
    }
    const body = request.json();
    const errors = createErrors(body);
    if (errors.length > 0) throw problem(422, "validation failed", errors);
    // An account's refusal, the same for every candidate (docs/web/runpod/create-a-pod.md).
    if (this.#faults.lowBalance) {
      throw problem(402, "Insufficient balance.");
    }
    const create = body as CreatePod;
    if (!create.gpu)
      throw problem(400, "exactly one of gpu or cpu is required; the fake has GPU pods only");
    const { allowedCudaVersions, minCudaVersion } = create.gpu;
    if ((allowedCudaVersions?.length ?? 0) > 0 && minCudaVersion !== undefined) {
      throw problem(400, "allowedCudaVersions and minCudaVersion are mutually exclusive");
    }
    const gpu = this.#catalog.find((one) => one.id === create.gpu?.id);
    if (!gpu) throw problem(400, `unknown gpu type ${create.gpu.id}`);
    const cloud = create.cloud ?? "SECURE";
    const count = create.gpu.count ?? 1;
    const offered = cloud === "SECURE" ? gpu.secure : gpu.community;
    const max = cloud === "SECURE" ? gpu.maxCount.secure : gpu.maxCount.community;
    const filter = {
      minCudaVersion,
      cudaVersions: allowedCudaVersions?.length ? allowedCudaVersions : undefined,
    };
    const filtered = filter.minCudaVersion !== undefined || filter.cudaVersions !== undefined;
    const hosts = cudaWithin(gpu, filter).filter(({ available }) => available);
    if (
      !offered ||
      count > max ||
      gpu.availability === "NONE" ||
      (filtered && hosts.length === 0)
    ) {
      throw problem(
        400,
        `There are no longer any instances available with the requested specifications (${gpu.id} on ${cloud}).`,
      );
    }
    const newest = hosts
      .map(({ version }) => version)
      .sort(compareCuda)
      .at(-1);
    const price = cloud === "SECURE" ? gpu.price.secure : gpu.price.community;
    const now = this.#now();
    const ports = create.ports ?? [];
    const pod: PodRecord = {
      spec: {
        id: podId(),
        name: create.name,
        image: create.image,
        env: { ...(create.env ?? {}) },
        ports: ports.map((port) => {
          const [number = "", protocol = "http"] = port.split("/");
          return { port: Number(number), protocol };
        }),
        gpu: { id: gpu.id, count, memoryGb: gpu.memory },
        cloud,
        diskGb: create.disk,
        cudaVersion: newest ?? null,
      },
      ports: [...ports],
      status: "PROVISIONING",
      perHour: price * count,
      createdAt: now,
      startedAt: undefined,
      terminatedAt: undefined,
      spans: [{ start: now, perHour: price * count }],
      launched: undefined,
      failure: undefined,
      launches: 0,
    };
    this.#pods.set(pod.spec.id, pod);
    // The answer says PROVISIONING; the container is asked for right after.
    setImmediate(() => this.#launch(pod));
    return pod;
  }

  /** Asks the launcher for the pod's container, unless a fault says it never starts. */
  #launch(pod: PodRecord): void {
    if (pod.status !== "PROVISIONING" && pod.status !== "STARTING") return;
    if (this.#faults.podStart === "never") {
      pod.status = "STARTING";
      return;
    }
    if (this.#faults.podStart === "fail") {
      pod.status = "ERROR";
      pod.failure = "The container failed to start (fault).";
      return;
    }
    pod.status = "STARTING";
    const launch = ++pod.launches;
    const settle = (launched: LaunchedPod | undefined, failure?: string) => {
      // A pod terminated, exited or restarted meanwhile does not take this container.
      if (pod.launches !== launch || pod.status !== "STARTING") {
        if (launched) this.#terminateContainer(pod);
        return;
      }
      if (launched) {
        pod.status = "RUNNING";
        pod.startedAt = this.#now();
        pod.launched = launched;
      } else {
        pod.status = "ERROR";
        pod.failure = failure;
      }
    };
    Promise.resolve()
      .then(() => this.launcher.launch(structuredClone(pod.spec)))
      .then(
        (result) => (isFailure(result) ? settle(undefined, result.failure) : settle(result)),
        (error: unknown) =>
          settle(undefined, error instanceof Error ? error.message : String(error)),
      );
  }

  #terminateContainer(pod: PodRecord): Promise<void> {
    return Promise.resolve()
      .then(() => this.launcher.terminate(pod.spec.id))
      .catch((error: unknown) => {
        console.error(
          `The fake Runpod could not terminate pod ${pod.spec.id}'s container: ${error instanceof Error ? error.message : error}`,
        );
      });
  }

  /** Opens or closes the pod's billing at its price. */
  #bill(pod: PodRecord, on: boolean): void {
    const last = pod.spans.at(-1);
    const open = last !== undefined && last.end === undefined;
    if (on && !open) pod.spans.push({ start: this.#now(), perHour: pod.perHour });
    if (!on && open) last.end = this.#now();
  }

  #live(id: string): PodRecord {
    const pod = this.#pods.get(id);
    if (!pod || pod.status === "TERMINATED") throw problem(404, "pod not found");
    return pod;
  }

  /** Runpod's `Pod`, as get-a-pod.md lists the fields Codeman reads, and others of its schema. */
  #podJson(pod: PodRecord): Record<string, unknown> {
    const at = (time: number | undefined) => (time === undefined ? null : timestamp(time));
    return {
      id: pod.spec.id,
      name: pod.spec.name,
      image: pod.spec.image,
      args: "",
      disk: pod.spec.diskGb ?? null,
      ports: [...pod.ports],
      env: { ...pod.spec.env },
      registry: null,
      status: pod.status,
      actions: POD_ACTIONS[pod.status],
      mounts: {},
      gpu: { id: pod.spec.gpu.id, count: pod.spec.gpu.count, vcpuCount: 8, memory: 32 },
      cloud: pod.spec.cloud,
      dataCenterId: "E2E-1",
      cudaVersion: pod.status === "RUNNING" ? pod.spec.cudaVersion : null,
      template: null,
      cost: BILLED.has(pod.status) ? pod.perHour : 0,
      locked: false,
      globalNetworking: { enabled: false },
      runtime:
        pod.status === "RUNNING"
          ? { uptime: Math.floor((this.#now() - (pod.startedAt ?? this.#now())) / 1000), ports: [] }
          : null,
      createdAt: at(pod.createdAt),
      startedAt: at(pod.startedAt),
    };
  }

  #podBilling(query: URLSearchParams): Record<string, unknown> {
    const now = this.#now();
    const window = billingWindow(query, now);
    const only = query.get("podId");
    const records: Record<string, unknown>[] = [];
    for (const bucket of window.buckets) {
      for (const pod of this.#pods.values()) {
        if (only && pod.spec.id !== only) continue;
        const amount = cost(pod.spans, bucket.start, bucket.end, now);
        if (amount <= 0) continue;
        records.push({
          startTime: timestamp(bucket.start),
          endTime: timestamp(bucket.end),
          podId: pod.spec.id,
          totalAmount: amount,
          gpuAmount: amount,
          cpuAmount: 0,
          diskAmount: 0,
        });
      }
    }
    const total = records.reduce((sum, record) => sum + (record.totalAmount as number), 0);
    return {
      records,
      metadata: {
        query: {
          startTime: timestamp(window.start),
          endTime: timestamp(window.end),
          bucketSize: window.bucketSize,
          ...(only ? { podId: only } : {}),
        },
        recordCount: records.length,
        totals: { totalAmount: total, gpuAmount: total, cpuAmount: 0, diskAmount: 0 },
        uniquePodCount: new Set(records.map((record) => record.podId)).size,
      },
    };
  }

  #billing(query: URLSearchParams): Record<string, unknown> {
    const now = this.#now();
    const window = billingWindow(query, now);
    const pods = [...this.#pods.values()].flatMap((pod) => pod.spans);
    const serverless = this.queues.ids().flatMap((id) => this.queues.spans(id));
    const records = window.buckets.flatMap((bucket) => {
      const podGpuAmount = cost(pods, bucket.start, bucket.end, now);
      const serverlessGpuAmount = cost(serverless, bucket.start, bucket.end, now);
      const totalAmount = podGpuAmount + serverlessGpuAmount;
      return totalAmount > 0
        ? [
            {
              startTime: timestamp(bucket.start),
              endTime: timestamp(bucket.end),
              totalAmount,
              podGpuAmount,
              serverlessGpuAmount,
            },
          ]
        : [];
    });
    const sum = (name: string) =>
      records.reduce((total, record) => total + (record[name as keyof typeof record] as number), 0);
    return {
      records,
      metadata: {
        query: {
          startTime: timestamp(window.start),
          endTime: timestamp(window.end),
          bucketSize: window.bucketSize,
        },
        recordCount: records.length,
        totals: {
          totalAmount: sum("totalAmount"),
          podGpuAmount: sum("podGpuAmount"),
          serverlessGpuAmount: sum("serverlessGpuAmount"),
        },
      },
    };
  }

  /**
   * Runpod's proxy: a running pod's exposed HTTP port, forwarded to the launcher's URL for it.
   * Anything else answers 404, as the proxy does for a pod or port that serves nothing.
   */
  async #proxy(request: FakeRequest, response: ServerResponse, rest: string): Promise<undefined> {
    const pod = this.#pods.get(request.params.id ?? "");
    const port = Number(request.params.port);
    const exposed = pod?.spec.ports.some((one) => one.port === port && one.protocol === "http");
    const target =
      pod?.status === "RUNNING" && exposed ? pod.launched?.urlForPort(port) : undefined;
    if (!target) {
      response
        .writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        .end("404 page not found");
      return undefined;
    }
    await forward(
      `${target}/${rest.split("/").map(encodeURIComponent).join("/")}`,
      request,
      response,
    );
    return undefined;
  }

  #reset(): void {
    for (const pod of this.#pods.values()) {
      if (pod.status !== "TERMINATED") this.#terminateContainer(pod);
    }
    this.#pods.clear();
    this.#faults = {};
    this.queues.hold = false;
    this.setup(structuredClone(this.#initial));
  }
}

interface CreatePod {
  name: string;
  image: string;
  gpu?: {
    id: string;
    count?: number;
    minCudaVersion?: string;
    allowedCudaVersions?: string[];
  };
  cloud?: "SECURE" | "COMMUNITY";
  env?: Record<string, string>;
  ports?: string[];
  disk?: number;
}

/** What breaks the create request's contract, in the style of Runpod's `errors`; empty when none. */
function createErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["$: expected object"];
  }
  const body = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof body.name !== "string" || body.name === "") errors.push("$.name: required string");
  if (typeof body.image !== "string" || body.image === "") {
    errors.push("$.image: required unless templateId is set");
  }
  if (body.cloud !== undefined && body.cloud !== "SECURE" && body.cloud !== "COMMUNITY") {
    errors.push("$.cloud: must be SECURE or COMMUNITY");
  }
  if (body.env !== undefined) {
    const env = body.env;
    if (typeof env !== "object" || env === null || Array.isArray(env)) {
      errors.push("$.env: expected object");
    } else {
      for (const [name, item] of Object.entries(env)) {
        if (typeof item !== "string") errors.push(`$.env.${name}: expected string`);
      }
    }
  }
  if (body.ports !== undefined) {
    if (!Array.isArray(body.ports)) errors.push("$.ports: expected array");
    else {
      body.ports.forEach((port, index) => {
        if (typeof port !== "string" || !/^\d{1,5}\/(http|tcp|udp)$/.test(port)) {
          errors.push(`$.ports[${index}]: expected port/protocol`);
        }
      });
    }
  }
  if (body.disk !== undefined && !(Number.isInteger(body.disk) && (body.disk as number) >= 1)) {
    errors.push("$.disk: expected integer >= 1");
  }
  const gpu = body.gpu as Record<string, unknown> | undefined;
  if (gpu !== undefined) {
    if (typeof gpu !== "object" || gpu === null) errors.push("$.gpu: expected object");
    else {
      if (typeof gpu.id !== "string") errors.push("$.gpu.id: required string");
      if (gpu.count !== undefined && !(Number.isInteger(gpu.count) && (gpu.count as number) >= 1)) {
        errors.push("$.gpu.count: expected integer >= 1");
      }
      if (
        gpu.minCudaVersion !== undefined &&
        !(typeof gpu.minCudaVersion === "string" && /^\d+\.\d+$/.test(gpu.minCudaVersion))
      ) {
        errors.push("$.gpu.minCudaVersion: expected major.minor");
      }
      const allowed = gpu.allowedCudaVersions;
      if (
        allowed !== undefined &&
        !(
          Array.isArray(allowed) &&
          allowed.every((v) => typeof v === "string" && /^\d+\.\d+$/.test(v))
        )
      ) {
        errors.push("$.gpu.allowedCudaVersions: expected major.minor versions");
      }
      const known = [
        "id",
        "count",
        "minCudaVersion",
        "allowedCudaVersions",
        "minRamPerGpu",
        "minVcpuCountPerGpu",
      ];
      for (const name of Object.keys(gpu)) {
        if (!known.includes(name))
          errors.push(`$.gpu: additional properties '${name}' not allowed`);
      }
    }
  }
  return errors;
}

/** A page of a cursor-paginated list: the cursor is the index of the page's first item. */
function page<T>(
  items: readonly T[],
  query: URLSearchParams,
  name: string,
  toJson: (item: T) => unknown,
): Record<string, unknown> {
  const limit = Number(query.get("limit") ?? 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw problem(422, "limit must be between 1 and 1000.");
  }
  const cursor = query.get("cursor");
  const start = cursor === null ? 0 : Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isInteger(start) || start < 0) throw problem(400, "invalid cursor");
  const end = start + limit;
  const hasNextPage = end < items.length;
  return {
    [name]: items.slice(start, end).map(toJson),
    pagination: {
      nextCursor: hasNextPage ? Buffer.from(String(end)).toString("base64url") : null,
      hasNextPage,
    },
  };
}

/** Runpod's pod IDs: lowercase letters and digits, which a host name or container name takes. */
function podId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(14)].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function setupOf(value: unknown): RunpodSetup {
  const setup = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const strings = (list: unknown) =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  if (
    (setup.keys !== undefined && !strings(setup.keys)) ||
    (setup.catalog !== undefined && !Array.isArray(setup.catalog)) ||
    (setup.endpoints !== undefined && !Array.isArray(setup.endpoints))
  ) {
    throw new HttpError(400, {
      message: "A setup may have keys, catalog and endpoints, each a list.",
    });
  }
  return {
    keys: setup.keys as string[] | undefined,
    catalog: (setup.catalog as unknown[] | undefined)?.map((gpu) => catalogGpuOf(gpu)),
    endpoints: (setup.endpoints as unknown[] | undefined)?.map(endpointOf),
  };
}

function faultsOf(value: unknown): RunpodFaults {
  const faults = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const hold = faults.holdQueues;
  if (
    Object.keys(faults).some((name) => !["podStart", "lowBalance", "holdQueues"].includes(name)) ||
    (faults.podStart !== undefined && faults.podStart !== "never" && faults.podStart !== "fail") ||
    (faults.lowBalance !== undefined && typeof faults.lowBalance !== "boolean") ||
    (hold !== undefined &&
      typeof hold !== "boolean" &&
      !(Array.isArray(hold) && hold.every((id) => typeof id === "string")))
  ) {
    throw new HttpError(400, {
      message:
        "Faults may have podStart (never or fail), lowBalance (a boolean) and holdQueues (true or endpoint IDs).",
    });
  }
  return faults as RunpodFaults;
}

/**
 * The fake for e2e/fakes/main.ts. The environment sets it up:
 *
 * - `FAKE_RUNPOD`: the setup as JSON, as `PUT /_fake/runpod/setup` takes it (keys, catalog,
 *   endpoints); the default catalog and no endpoint when unset;
 * - `FAKE_RUNPOD_LAUNCHER`: the orchestrator's launcher API (launcher.ts, `httpLauncher`), with
 *   `FAKE_RUNPOD_LAUNCHER_TOKEN`; without it, pods run and serve nothing;
 * - `FAKE_RUNPOD_WORKER`: an OpenAI-compatible origin the queues forward jobs to; the echo worker
 *   when unset.
 */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  let setup: RunpodSetup;
  try {
    setup = setupOf(env.FAKE_RUNPOD ? JSON.parse(env.FAKE_RUNPOD) : {});
  } catch (error) {
    const message =
      error instanceof HttpError ? (error.body as { message: string }).message : String(error);
    throw new Error(`FAKE_RUNPOD: ${message}`);
  }
  return new RunpodFake(setup, {
    launcher: env.FAKE_RUNPOD_LAUNCHER
      ? httpLauncher(env.FAKE_RUNPOD_LAUNCHER, { token: env.FAKE_RUNPOD_LAUNCHER_TOKEN })
      : undefined,
    backend: env.FAKE_RUNPOD_WORKER ? openAiBackend(env.FAKE_RUNPOD_WORKER) : undefined,
  }).server;
}
