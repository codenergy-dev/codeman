import type { Fetch } from "../budget.ts";
import {
  type CudaVersion,
  DEFAULT_HOSTS,
  type Endpoint,
  type GpuProvider,
  type HostKind,
  type Pod,
  type PodHost,
  type PodSpec,
  type PodStatus,
  type ServerlessHost,
} from "./gpu.ts";

const API = "https://api.runpod.io/v2";
const HOUR_MS = 3_600_000;

/** Pod states as Runpod names them, in Codeman's terms. */
const STATUS: Record<string, PodStatus> = {
  PROVISIONING: "starting",
  STARTING: "starting",
  RUNNING: "running",
  EXITED: "stopped",
  ERROR: "failed",
  TERMINATED: "terminated",
};

/** Runpod's clouds, by the kind of host they are (docs/web/runpod/choose-a-pod.md). */
const CLOUDS: Readonly<Record<HostKind, "SECURE" | "COMMUNITY">> = {
  secure: "SECURE",
  community: "COMMUNITY",
};

/** How messages name each cloud. */
const CLOUD_NAMES: Readonly<Record<HostKind, string>> = {
  secure: "Secure Cloud",
  community: "Community Cloud",
};

/** The priorities Runpod offers pods: its REST API has no interruptible ones. */
const PRIORITIES = ["on-demand"];

/** The fields of Runpod's `Pod` that Codeman reads. See docs/web/runpod/get-a-pod.md. */
interface RunpodPod {
  id: string;
  name: string;
  status: string;
  image?: string;
  env?: Record<string, string> | null;
  gpu?: { id?: string; count?: number } | null;
  cost?: number;
  createdAt: string;
  cudaVersion?: string | null;
  cloud?: string | null;
}

interface RunpodGpu {
  id: string;
  /** VRAM, in GB. */
  memory?: number;
  pool?: string | null;
  secure?: boolean;
  community?: boolean;
  price?: { secure?: number; community?: number; serverless?: number };
  /** With `include=AVAILABILITY`: `NONE`, `LOW`, `MEDIUM` or `HIGH`. */
  availability?: string | null;
  cudaVersions?: { version?: unknown; available?: unknown }[];
}

interface RunpodEndpoint {
  id: string;
  type?: string;
  gpu?: { pools?: string[]; excludedTypes?: string[]; count?: number } | null;
  workers?: { min?: number; max?: number; idleTimeout?: number };
  env?: Record<string, string> | null;
}

/**
 * Runpod's REST API v2, for pods and Serverless endpoints, with an account API key. Pods are
 * created on Secure Cloud unless their `hosts` allow Community Cloud. See docs/web/runpod/.
 */
export class Runpod implements GpuProvider {
  readonly name = "runpod";
  readonly pods: Required<Omit<PodHost, "unservedImages">>;
  readonly serverless: ServerlessHost;
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #now: () => Date;
  /** The catalog's GPU types, by ID, as read so far. */
  readonly #gpus = new Map<string, Promise<RunpodGpu | undefined>>();

  constructor(apiKey: string, fetchFn: Fetch = fetch, now: () => Date = () => new Date()) {
    this.#apiKey = apiKey;
    this.#fetch = fetchFn;
    this.#now = now;
    this.pods = {
      price: (gpuType, host) => this.#podPrice(gpuType, host),
      memory: async (gpuType) => {
        const memory = (await this.#gpu(gpuType))?.memory;
        return typeof memory === "number" && memory > 0 ? memory : undefined;
      },
      cudaVersions: (gpuType, min, host) => this.#cudaVersions(gpuType, min, host),
      create: (spec) => this.#createPod(spec),
      get: (id) => this.#getPod(id),
      list: (env) => this.#listPods(env),
      terminate: (id) => this.#terminatePod(id),
      url: async (id, port) => `https://${id}-${port}.proxy.runpod.net`,
      billing: (ids, since) => this.#podBilling(ids, since),
    };
    this.serverless = {
      endpoint: (id) => this.#endpoint(id),
      price: (id) => this.#serverlessPrice(id),
      queueUrl: (id) => `https://api.runpod.ai/v2/${encodeURIComponent(id)}`,
    };
  }

  /**
   * `GET /v2/billing`, by hour: the account's total for each hour from `start` (UTC). The API
   * snaps the window to whole hours, and takes `startTime` only with `endTime`.
   */
  async billedHours(start: Date, end: Date): Promise<Map<number, number>> {
    const from = new Date(start.getTime() - (start.getTime() % HOUR_MS));
    const to = new Date(Math.ceil(end.getTime() / HOUR_MS) * HOUR_MS);
    const response = (await this.#request(`/billing?bucketSize=hour&${window(from, to)}`)) as {
      records?: { startTime?: string; totalAmount?: number }[];
    };
    const hours = new Map<number, number>();
    for (const record of response.records ?? []) {
      const at = Date.parse(record.startTime ?? "");
      if (!Number.isFinite(at) || at < from.getTime()) continue;
      const hour = at - (at % HOUR_MS);
      hours.set(hour, (hours.get(hour) ?? 0) + amount(record.totalAmount));
    }
    return hours;
  }

  /** A GPU type from Runpod's catalog, read once per type; undefined when Runpod has none. */
  #gpu(gpuType: string): Promise<RunpodGpu | undefined> {
    let gpu = this.#gpus.get(gpuType);
    if (!gpu) {
      gpu = this.#request(
        `/catalog/gpus/${encodeURIComponent(gpuType)}`,
        "GET",
        undefined,
        [404],
      ) as Promise<RunpodGpu | undefined>;
      // A failed read is not kept: the next call reads again.
      gpu.catch(() => this.#gpus.delete(gpuType));
      this.#gpus.set(gpuType, gpu);
    }
    return gpu;
  }

  async #podPrice(gpuType: string, host: HostKind = "secure"): Promise<number> {
    const gpu = await this.#gpu(gpuType);
    if (!gpu) {
      throw new Error(
        `Runpod has no GPU type "${gpuType}". \`gpu\` takes the GPU's ID, such as "NVIDIA RTX A6000", not its display name; see https://docs.runpod.io/references/gpu-types.`,
      );
    }
    const hourly = gpu.price?.[host];
    if (gpu[host] === false || typeof hourly !== "number" || !(hourly > 0)) {
      throw new Error(`Runpod does not offer ${gpuType} on ${CLOUD_NAMES[host]}.`);
    }
    return hourly / 3600;
  }

  /**
   * `GET /v2/catalog/gpus/{id}` with the pods' availability on a cloud, from a CUDA version when
   * one is given (docs/web/runpod/get-a-gpu-type.md); undefined when Runpod has no such GPU type.
   */
  #availability(
    gpuType: string,
    host: HostKind,
    minCudaVersion?: string,
  ): Promise<RunpodGpu | undefined> {
    const query = `include=AVAILABILITY&product=POD&cloud=${CLOUDS[host]}${minCudaVersion ? `&minCudaVersion=${encodeURIComponent(minCudaVersion)}` : ""}`;
    return this.#request(
      `/catalog/gpus/${encodeURIComponent(gpuType)}?${query}`,
      "GET",
      undefined,
      [404],
    ) as Promise<RunpodGpu | undefined>;
  }

  /** The CUDA versions a cloud offers from `min`: a missing `cudaVersions` is an empty one. */
  async #cudaVersions(
    gpuType: string,
    min: string,
    host: HostKind = "secure",
  ): Promise<CudaVersion[]> {
    const gpu = await this.#availability(gpuType, host, min);
    return (gpu?.cudaVersions ?? []).flatMap(({ version, available }) =>
      typeof version === "string" ? [{ version, available: available === true }] : [],
    );
  }

  /**
   * Creates the pod on the first cloud of its `hosts` whose hosts have room (decision 9 of the
   * plan for Salad pods). With one kind of host, the pod is created there without asking, as
   * before; with several, the clouds without room, or that do not offer the GPU type, are passed
   * over, and a creation that fails moves on to the next.
   */
  async #createPod(spec: PodSpec): Promise<Pod> {
    if (spec.priority !== undefined && !PRIORITIES.includes(spec.priority)) {
      throw new Error(
        `Runpod offers no pod with the priority \`${spec.priority}\`; it offers ${PRIORITIES.map((p) => `\`${p}\``).join(", ")}.`,
      );
    }
    const hosts = spec.hosts ?? DEFAULT_HOSTS;
    const [only] = hosts;
    if (hosts.length === 1 && only) return this.#createOn(spec, only);
    const problems: string[] = [];
    for (const host of hosts) {
      const gpu = await this.#availability(spec.gpuType, host, spec.minCudaVersion);
      if (!gpu || gpu[host] === false) {
        problems.push(`${CLOUD_NAMES[host]} does not offer it`);
        continue;
      }
      if (!gpu.availability || gpu.availability === "NONE") {
        problems.push(`${CLOUD_NAMES[host]} has no room`);
        continue;
      }
      try {
        return await this.#createOn(spec, host);
      } catch (error) {
        problems.push(`${CLOUD_NAMES[host]}: ${error instanceof Error ? error.message : error}`);
      }
    }
    throw new Error(
      `Runpod created no pod with ${spec.gpuType}${spec.minCudaVersion ? ` and CUDA ${spec.minCudaVersion} or newer` : ""}: ${problems.join("; ")}.`,
    );
  }

  async #createOn(spec: PodSpec, host: HostKind): Promise<Pod> {
    const pod = (await this.#request("/pods", "POST", {
      name: spec.name,
      image: spec.image,
      gpu: {
        id: spec.gpuType,
        count: 1,
        ...(spec.minCudaVersion ? { minCudaVersion: spec.minCudaVersion } : {}),
      },
      // Secure Cloud unless the settings' `hosts` allow Community Cloud (decision 1 of the plan
      // for Salad pods, which made decision 6 of the self-hosted inference plan a default).
      cloud: CLOUDS[host],
      env: spec.env,
      ports: [`${spec.port}/http`],
      disk: spec.diskGb,
    })) as RunpodPod;
    return { host, ...toPod(pod) };
  }

  async #getPod(id: string): Promise<Pod | undefined> {
    const pod = (await this.#request(`/pods/${encodeURIComponent(id)}`, "GET", undefined, [404])) as
      | RunpodPod
      | undefined;
    return pod ? toPod(pod) : undefined;
  }

  async #listPods(env: Record<string, string>): Promise<Pod[]> {
    const pods: Pod[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 100; page++) {
      const response = (await this.#request(
        `/pods${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      )) as {
        pods?: RunpodPod[];
        pagination?: { nextCursor?: string | null; hasNextPage?: boolean };
      };
      for (const pod of response.pods ?? []) {
        const found = toPod(pod);
        if (Object.entries(env).every(([name, value]) => found.env[name] === value)) {
          pods.push(found);
        }
      }
      cursor = response.pagination?.nextCursor;
      if (!response.pagination?.hasNextPage || !cursor) return pods;
    }
    throw new Error("Too many Runpod pods to list.");
  }

  async #terminatePod(id: string): Promise<void> {
    await this.#request(`/pods/${encodeURIComponent(id)}`, "DELETE", undefined, [404]);
  }

  /** `GET /v2/billing/pods`, by day, once for every pod; records are per pod per bucket. */
  async #podBilling(ids: readonly string[], since: Date): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const start = new Date(
      Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
    );
    const now = this.#now();
    // Up to the end of today, a day's boundary as the bucket size asks.
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const response = (await this.#request(
      `/billing/pods?bucketSize=day&${window(start, end)}`,
    )) as {
      records?: { podId?: string; totalAmount?: number }[];
    };
    const wanted = new Set(ids);
    const billed: Record<string, number> = {};
    for (const record of response.records ?? []) {
      if (!record.podId || !wanted.has(record.podId)) continue;
      billed[record.podId] = (billed[record.podId] ?? 0) + amount(record.totalAmount);
    }
    return billed;
  }

  async #endpoint(id: string): Promise<Endpoint> {
    const endpoint = (await this.#request(
      `/serverless/${encodeURIComponent(id)}`,
    )) as RunpodEndpoint;
    return {
      id: endpoint.id,
      type: endpoint.type,
      workersMin: endpoint.workers?.min ?? 0,
      workersMax: endpoint.workers?.max ?? 0,
      idleTimeoutSeconds: endpoint.workers?.idleTimeout,
      gpuCount: endpoint.gpu?.count ?? 1,
      env: endpoint.env ?? {},
    };
  }

  /**
   * The flex price of the endpoint's dearest GPU type, times its GPUs per worker: a worker may
   * land on any type of its pools. Throws when no price is listed.
   */
  async #serverlessPrice(id: string): Promise<number> {
    const endpoint = (await this.#request(
      `/serverless/${encodeURIComponent(id)}`,
    )) as RunpodEndpoint;
    const pools = new Set(endpoint.gpu?.pools ?? []);
    const excluded = new Set(endpoint.gpu?.excludedTypes ?? []);
    const { gpus } = (await this.#request("/catalog/gpus")) as { gpus?: RunpodGpu[] };
    const prices = (gpus ?? [])
      .filter((gpu) => gpu.pool && pools.has(gpu.pool) && !excluded.has(gpu.id))
      .map((gpu) => gpu.price?.serverless)
      .filter((price): price is number => typeof price === "number" && price > 0);
    if (prices.length === 0)
      throw new Error(`Runpod lists no Serverless price for endpoint ${id}.`);
    return (Math.max(...prices) * (endpoint.gpu?.count ?? 1)) / 3600;
  }

  async #request(
    path: string,
    method = "GET",
    body?: unknown,
    absent: readonly number[] = [],
  ): Promise<unknown> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (absent.includes(response.status)) return undefined;
    if (!response.ok) {
      const problem = describeProblem(await response.text().catch(() => ""));
      throw new Error(
        `Runpod ${method} ${path.split("?")[0]} failed with ${response.status}${problem ? `: ${problem}` : "."}`,
      );
    }
    return response.status === 204 ? undefined : response.json();
  }
}

function toPod(pod: RunpodPod): Pod {
  return {
    id: pod.id,
    name: pod.name,
    status: STATUS[pod.status] ?? "starting",
    image: pod.image ?? "",
    env: pod.env ?? {},
    gpuType: pod.gpu?.id,
    createdAt: new Date(pod.createdAt),
    pricePerSecond: typeof pod.cost === "number" && pod.cost > 0 ? pod.cost / 3600 : undefined,
    ...(typeof pod.cudaVersion === "string" && pod.cudaVersion !== ""
      ? { cudaVersion: pod.cudaVersion }
      : {}),
    ...(pod.cloud === "SECURE" ? { host: "secure" as const } : {}),
    ...(pod.cloud === "COMMUNITY" ? { host: "community" as const } : {}),
  };
}

/** RFC 3339 in UTC, to the second, as Runpod's examples write it: `2026-10-01T00:00:00Z`. */
function timestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** A billing query's window: Runpod refuses `startTime` without `endTime` (400). */
function window(start: Date, end: Date): string {
  return `startTime=${encodeURIComponent(timestamp(start))}&endTime=${encodeURIComponent(timestamp(end))}`;
}

/**
 * What an RFC 9457 error says: its title, detail and validation errors, on one line. Runpod's
 * requests carry no secret (pods' environments hold only hashes and public values), and other
 * bodies are left out.
 */
export function describeProblem(body: string): string | undefined {
  let problem: unknown;
  try {
    problem = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof problem !== "object" || problem === null) return undefined;
  const { title, detail, errors } = problem as Record<string, unknown>;
  const parts = [title, detail, ...(Array.isArray(errors) ? errors : [])].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  if (parts.length === 0) return undefined;
  const text = parts.join(" — ").replace(/\s+/g, " ").trim();
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
