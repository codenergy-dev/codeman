/**
 * A GPU cloud that serves Codeman's models: pods (a container on a GPU, billed while it exists),
 * Serverless endpoints (workers started on demand, billed while they run), or both. Runpod is the
 * first adapter; see docs/architecture.md#self-hosted-inference.
 */
export interface GpuProvider {
  readonly name: string;
  readonly pods?: PodHost | undefined;
  readonly serverless?: ServerlessHost | undefined;
  /** What the account spent this calendar month (UTC), in USD, on every kind of resource. */
  monthSpent(now: Date): Promise<number>;
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
}

export interface PodHost {
  /** The price of one GPU of this type on a pod, in USD per second. Throws when not offered. */
  price(gpuType: string): Promise<number>;
  create(spec: PodSpec): Promise<Pod>;
  /** The pod, or undefined when it does not exist (terminated pods included). */
  get(id: string): Promise<Pod | undefined>;
  /** Every pod of the account whose environment has `env`'s values. */
  list(env: Record<string, string>): Promise<Pod[]>;
  /** Terminates the pod; one that no longer exists is not an error. */
  terminate(id: string): Promise<void>;
  /** Where the pod's exposed `port` is reached. */
  url(id: string, port: number): string;
  /** What each of these pods was billed since `since`, in USD; pods without billing are left out. */
  billing(ids: readonly string[], since: Date): Promise<Record<string, number>>;
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
  /** The OpenAI-compatible API of the endpoint's workers. */
  openAiUrl(endpoint: string): string;
}

/**
 * What the account spent this calendar month (UTC), in USD: its billing, plus what its live
 * pods cost so far this month beyond what each was billed. Runpod's billing leaves out a running
 * pod for 40 minutes and more, so a pod kept between runs would not count against the budget.
 */
export async function accountMonthSpent(gpu: GpuProvider, now: Date): Promise<number> {
  const billed = await gpu.monthSpent(now);
  if (!gpu.pods) return billed;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const live = (await gpu.pods.list({})).filter(
    (pod) => pod.status !== "terminated" && pod.pricePerSecond !== undefined,
  );
  if (live.length === 0) return billed;
  const podBilled = await gpu.pods.billing(
    live.map((pod) => pod.id),
    start,
  );
  let unbilled = 0;
  for (const pod of live) {
    const from = pod.createdAt > start ? pod.createdAt : start;
    const estimate = podCost(from, now, pod.pricePerSecond ?? 0);
    unbilled += Math.max(0, estimate - (podBilled[pod.id] ?? 0));
  }
  return billed + unbilled;
}

/** Codeman's own limits on a Serverless endpoint; see docs/installation.md. */
export const MAX_IDLE_TIMEOUT_SECONDS = 60;

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
 * Waits until the pod runs and `ready` says its service answers, polling every `interval`.
 * Throws when the pod fails, stops or disappears, or `timeoutMs` passes.
 */
export async function waitUntilReady(
  host: Pick<PodHost, "get">,
  id: string,
  ready: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs?: number; wait?: (ms: number) => Promise<void> },
): Promise<Pod> {
  const wait = options.wait ?? sleep;
  const interval = options.intervalMs ?? 10_000;
  for (let waited = 0; ; waited += interval) {
    const pod = await host.get(id);
    if (!pod) throw new Error(`Pod ${id} no longer exists.`);
    if (pod.status === "failed" || pod.status === "stopped" || pod.status === "terminated") {
      throw new Error(`Pod ${id} is ${pod.status}.`);
    }
    if (pod.status === "running" && (await ready().catch(() => false))) return pod;
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
