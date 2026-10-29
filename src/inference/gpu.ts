import type { BilledHours } from "../budget.ts";

/**
 * A GPU cloud that serves Codeman's models: pods (a container on a GPU, billed while it exists),
 * Serverless endpoints (workers started on demand, billed while they run), or both. Runpod is the
 * first adapter; see docs/inference/self-hosted.md.
 */
export interface GpuProvider {
  readonly name: string;
  readonly pods?: PodHost | undefined;
  readonly serverless?: ServerlessHost | undefined;
  /**
   * What the account was billed for each hour from `start` until `end`, in USD, on every kind of
   * resource. Hours not billed yet are left out. Absent when the provider has no billing API.
   */
  billedHours?(start: Date, end: Date): Promise<BilledHours>;
}

/**
 * What opens a GPU account: its key, and, for a provider whose key reaches several of them, which
 * organization and project of the account Codeman works in.
 */
export interface GpuAccount {
  key: string;
  organization?: string | undefined;
  project?: string | undefined;
}

/**
 * The kinds of host a pod may run on (decision 1 of the plan for Salad pods): `secure`, the
 * provider's own or contracted data centers, and `community`, machines third parties run, which
 * the agent's prompts, the repository's code among them, reach. The `hosts` setting lists them by
 * preference, `[secure]` by default.
 */
export const HOST_KINDS = ["secure", "community"] as const;
export type HostKind = (typeof HOST_KINDS)[number];

/** The kinds of host when no setting names them. */
export const DEFAULT_HOSTS: readonly HostKind[] = ["secure"];

export function isHostKind(text: string): text is HostKind {
  return (HOST_KINDS as readonly string[]).includes(text);
}

/** What a new pod runs. */
export interface PodSpec {
  /** For people reading the provider's console; Codeman finds its pods by `env`. */
  name: string;
  image: string;
  env: Record<string, string>;
  /** The HTTP port the provider exposes. */
  port: number;
  gpuType: string;
  /** Container disk, in GB. */
  diskGb: number;
  /** The lowest CUDA version its host must offer, as `major.minor`; any when undefined. */
  minCudaVersion?: string | undefined;
  /**
   * The kinds of host it may run on, by preference: it runs on the first whose hosts have room.
   * `DEFAULT_HOSTS` when undefined.
   */
  hosts?: readonly HostKind[] | undefined;
  /** Its priority, as the provider names it; the provider's highest when undefined. */
  priority?: string | undefined;
  /**
   * The shared memory (`/dev/shm`) it needs, in GB, for a provider that sets it per container;
   * the provider's default when undefined.
   */
  sharedMemoryGb?: number | undefined;
}

/** A CUDA version that hosts of a GPU type offer, and whether one of them has room now. */
export interface CudaVersion {
  version: string;
  available: boolean;
}

export type PodStatus = "starting" | "running" | "stopped" | "failed" | "terminated";

export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  image: string;
  env: Record<string, string>;
  gpuType: string | undefined;
  createdAt: Date;
  /** What the provider bills for it, in USD per second; 0 or undefined when it does not say. */
  pricePerSecond: number | undefined;
  /** The CUDA version its host reports, once it has one. */
  cudaVersion?: string | undefined;
  /** The kind of host it runs on, when the provider says. */
  host?: HostKind | undefined;
  /**
   * Whether the provider has given it a machine yet; undefined when the provider does not say,
   * as Runpod, whose pods have one once created.
   */
  allocated?: boolean | undefined;
}

export interface PodHost {
  /**
   * Pod images whose gateway cannot serve on this provider, which a run refuses before creating
   * a pod; none when undefined.
   */
  readonly unservedImages?: ReadonlySet<string> | undefined;
  /**
   * The price of one GPU of this type on a pod, on a kind of host (`secure` by default) and at a
   * priority (the provider's highest by default), in USD per second. Throws when not offered there.
   */
  price(gpuType: string, host?: HostKind, priority?: string): Promise<number>;
  /**
   * The memory of one GPU of this type, in GB, as the provider lists it; undefined when it does
   * not say. The gateway starts its search for the context that fits from it.
   */
  memory?(gpuType: string): Promise<number | undefined>;
  /**
   * The CUDA versions, from `min` up, that the hosts of a GPU type offer pods, on a kind of host
   * (`secure` by default), each with whether one has room now; empty when none does.
   */
  cudaVersions?(gpuType: string, min: string, host?: HostKind): Promise<CudaVersion[]>;
  create(spec: PodSpec): Promise<Pod>;
  /** The pod, or undefined when it does not exist (terminated pods included). */
  get(id: string): Promise<Pod | undefined>;
  /** Every pod of the account whose environment has `env`'s values. */
  list(env: Record<string, string>): Promise<Pod[]>;
  /** Terminates the pod; one that no longer exists is not an error. */
  terminate(id: string): Promise<void>;
  /**
   * Where the pod's exposed `port` is reached. Some providers know it only once the pod is
   * created, so it may read the pod.
   */
  url(id: string, port: number): Promise<string>;
  /**
   * What each of these pods was billed since `since`, in USD; pods without billing are left out.
   * Absent when the provider has no billing API.
   */
  billing?(ids: readonly string[], since: Date): Promise<Record<string, number>>;
}

export interface Endpoint {
  id: string;
  /** `QUEUE` or `LOAD_BALANCER`, as the provider names them. */
  type: string | undefined;
  /** Workers that run all the time. */
  workersMin: number;
  workersMax: number;
  /** How long a worker stays up, and billed, after its last request. */
  idleTimeoutSeconds: number | undefined;
  gpuCount: number;
  env: Record<string, string>;
}

export interface ServerlessHost {
  endpoint(id: string): Promise<Endpoint>;
  /** What one worker of the endpoint costs, in USD per second: its dearest GPU type. */
  price(endpoint: string): Promise<number>;
  /** The endpoint's job queue, which the agent job's gateway sends requests through. */
  queueUrl(endpoint: string): string;
}

/** Codeman's own limits on a Serverless endpoint; see docs/installation/runpod.md#serverless. */
export const MAX_IDLE_TIMEOUT_SECONDS = 300;

/**
 * Why Codeman refuses a Serverless endpoint: it must start workers only on demand (no active
 * worker), one at most, stopping them soon after their last request. Empty when it is fine.
 */
export function endpointProblems(endpoint: Endpoint): string[] {
  const problems: string[] = [];
  if (endpoint.type !== undefined && endpoint.type !== "QUEUE") {
    problems.push(`it is a ${endpoint.type} endpoint; the vLLM worker needs a queue-based one`);
  }
  if (endpoint.workersMin !== 0) {
    problems.push(
      `it keeps ${endpoint.workersMin} active worker(s), billed all the time; set active workers to 0`,
    );
  }
  if (endpoint.workersMax === 0) {
    problems.push(
      "its max workers is 0, as the provider sets it after 7 days without requests; set it to 1",
    );
  } else if (endpoint.workersMax !== 1) {
    problems.push(`it may run ${endpoint.workersMax} workers at once; set max workers to 1`);
  }
  const idle = endpoint.idleTimeoutSeconds;
  if (idle === undefined || idle > MAX_IDLE_TIMEOUT_SECONDS) {
    problems.push(
      `its idle timeout is ${idle === undefined ? "unknown" : `${idle} seconds`}; set it to ${MAX_IDLE_TIMEOUT_SECONDS} seconds or less`,
    );
  }
  return problems;
}

/**
 * When a run's budget is spent: what the pod costs per second, from `start`, adds up to
 * `limit`. A pod costs the same whether or not the agent is generating.
 */
export function deadline(start: Date, limit: number, pricePerSecond: number): Date {
  if (!(pricePerSecond > 0)) throw new Error("A pod's price must be positive.");
  return new Date(start.getTime() + Math.floor((limit / pricePerSecond) * 1000));
}

/** What a pod costs from `start` to `end`, in USD. */
export function podCost(start: Date, end: Date, pricePerSecond: number): number {
  return (Math.max(0, end.getTime() - start.getTime()) / 1000) * pricePerSecond;
}

/**
 * A pod's gateway says its model could not be served, and why, such as a model that does not fit
 * the GPU: waiting longer would not help, and another pod of the same settings would fail the
 * same way.
 */
export class PodStartFailure extends Error {}

/**
 * The provider has no room for the pod now: no GPU of its type on the hosts it may use, or no
 * machine allocated in time (decision 3 of the plan for falling back to the next profile). Not a
 * mistake in the settings: the run falls back to the next profile.
 */
export class PodUnavailable extends Error {}

/**
 * Waits until the pod runs and `ready` says its service answers, polling every `interval`.
 * Throws when the pod fails, stops or disappears, or `timeoutMs` passes; a `PodUnavailable` when
 * the provider has allocated it no machine once `allocationMs` passes.
 */
export async function waitUntilReady(
  host: Pick<PodHost, "get">,
  id: string,
  ready: () => Promise<boolean>,
  options: {
    timeoutMs: number;
    allocationMs?: number | undefined;
    intervalMs?: number;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<Pod> {
  const wait = options.wait ?? sleep;
  const interval = options.intervalMs ?? 10_000;
  for (let waited = 0; ; waited += interval) {
    const pod = await host.get(id);
    if (!pod) throw new Error(`Pod ${id} no longer exists.`);
    if (pod.status === "failed" || pod.status === "stopped" || pod.status === "terminated") {
      throw new Error(`Pod ${id} is ${pod.status}.`);
    }
    if (
      pod.allocated === false &&
      options.allocationMs !== undefined &&
      waited >= options.allocationMs
    ) {
      throw new PodUnavailable(
        `Pod ${id} got no machine within ${Math.round(options.allocationMs / 60_000)} minutes.`,
      );
    }
    if (pod.status === "running") {
      const served = await ready().catch((error: unknown) => {
        if (error instanceof PodStartFailure) throw error;
        return false;
      });
      if (served) return pod;
    }
    if (waited >= options.timeoutMs) {
      throw new Error(
        `Pod ${id} was not ready within ${Math.round(options.timeoutMs / 60_000)} minutes.`,
      );
    }
    await wait(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
