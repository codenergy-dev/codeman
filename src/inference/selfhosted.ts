import { createHmac, randomBytes } from "node:crypto";
import { usd } from "../budget.ts";
import { sha256 } from "../gateway/gateway.ts";
import { GATEWAY_PORT } from "../gateway/pod.ts";
import type { GatewayUsage } from "../gateway/usage.ts";
import type { RepositoryRef } from "../platform/types.ts";
import type { Log } from "../runtime/runtime.ts";
import type { InferenceEngine } from "./engine.ts";
import {
  endpointProblems,
  type GpuProvider,
  type Pod,
  type PodHost,
  podCost,
  type ServerlessHost,
  waitUntilReady,
} from "./gpu.ts";
import type { InferenceProvider, OpenedRun, RunRequest, RunUsage } from "./provider.ts";

/** How long a new pod has to pull its image and model and serve it. */
export const START_MINUTES = 25;
/** How long a kept pod waits for its task's next run (decision 12 of the plan). */
export const KEPT_IDLE_MINUTES = 15;
/** A run whose agent sends no request for this long has lost it. */
export const RUN_IDLE_MINUTES = 30;
/** Container disk of a pod, in GB: the model and Ollama's image. */
const DISK_GB = 80;
/** Billing is read this far back; older pods have left the spend table's refreshed rows. */
const BILLING_DAYS = 30;

/** What a task's self-hosted runs use, as `select` resolved it from the settings. */
export interface SelfHostedSettings {
  /** The engine's model name. */
  model: string;
  engine: InferenceEngine;
  /** What the task spent so far, from its record: providers bill pods, not tasks. */
  taskSpent: number;
  /** The pods the task's record lists, whose billing refreshes its spend. */
  pods: readonly string[];
}

export interface PodSettings extends SelfHostedSettings {
  gpuType: string;
  /** The pod image, by digest. */
  image: string;
  /** `task`: a pod serves the task's next run too, while the task goes on; `run`: one run. */
  reuse: "task" | "run";
}

/** What `close` needs to find a pod run again. Travels in plain text between jobs. */
export interface PodHandle {
  mode: "pod";
  podId: string;
  /** Names the pod's admin token, which only the account key derives. */
  nonce: string;
  url: string;
  /** When the run's cost started: a new pod's creation, or a kept pod's new run. */
  start: number;
  pricePerSecond: number;
  reuse: "task" | "run";
}

/** The environment that marks a pod as Codeman's, for one repository. */
export function podOwner(repository: RepositoryRef): Record<string, string> {
  return { CODEMAN_REPOSITORY: `${repository.owner}/${repository.name}` };
}

/**
 * The token that manages a pod's gateway. It is derived from the account key, so only the jobs
 * that hold that key (open-key, close-key, release-pod) can manage pods, and the pod keeps only
 * its hash.
 */
export function adminToken(accountKey: string, nonce: string): string {
  return createHmac("sha256", accountKey)
    .update(`codeman-gateway-admin:${nonce}`)
    .digest("base64url");
}

export interface SelfHostedOptions {
  repository: RepositoryRef;
  gpu: GpuProvider;
  accountKey: string;
  now?: () => Date;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Self-hosted inference on pods: each run gets a token for a gateway in a pod that serves the
 * task's model, created for the run or kept from the task's previous run. See
 * docs/architecture.md#self-hosted-inference.
 */
export class PodInference implements InferenceProvider {
  readonly name: string;
  readonly #settings: PodSettings;
  readonly #options: SelfHostedOptions;
  readonly #host: PodHost;

  constructor(settings: PodSettings, options: SelfHostedOptions) {
    if (!options.gpu.pods) throw new Error(`${options.gpu.name} has no pods.`);
    this.name = `${options.gpu.name} pods`;
    this.#settings = settings;
    this.#options = options;
    this.#host = options.gpu.pods;
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  async taskSpent(): Promise<number> {
    return this.#settings.taskSpent;
  }

  async monthSpent(): Promise<number> {
    return this.#options.gpu.monthSpent(this.#now());
  }

  async open(run: RunRequest, log: Log): Promise<OpenedRun> {
    const kept = await this.#sweep(run.task, log);
    const token = randomBytes(32).toString("base64url");
    const handle = kept
      ? await this.#reuse(kept, run, token, log)
      : await this.#create(run, token, log);
    const status = (await this.#admin(handle, "GET", "/admin/status")) as {
      contextLength?: number;
    };
    return {
      handle: JSON.stringify(handle),
      credential: token,
      baseUrl: `${handle.url}/v1`,
      contextLength: status.contextLength,
    };
  }

  /**
   * Ends the run on the pod, reads what it used, and keeps the pod for the task's next run or
   * terminates it. The run's cost is the pod's time since the run started, at its price.
   */
  async close(text: string, log: Log): Promise<RunUsage> {
    const handle = parseHandle(text);
    if (handle.mode !== "pod") throw new Error("The handle is not a pod run's.");
    let usage: GatewayUsage | undefined;
    try {
      usage = (await this.#admin(handle, "POST", "/admin/end")) as GatewayUsage | undefined;
    } catch (error) {
      log.warning(
        `Could not read the run's usage from its pod: ${error instanceof Error ? error.message : error}`,
      );
    }
    const keep = handle.reuse === "task" && usage !== undefined;
    if (!keep) {
      await this.#host.terminate(handle.podId);
      log.info(`Terminated pod ${handle.podId}.`);
    } else {
      log.info(
        `Kept pod ${handle.podId} for the task's next run, for ${KEPT_IDLE_MINUTES} minutes at most.`,
      );
    }
    const cost = podCost(new Date(handle.start), this.#now(), handle.pricePerSecond);
    const pods = [...new Set([...this.#settings.pods, handle.podId])];
    const podCosts = await this.#host
      .billing(pods, new Date(this.#now().getTime() - BILLING_DAYS * 86_400_000))
      .catch((error: unknown) => {
        log.warning(
          `Could not read the pods' billing: ${error instanceof Error ? error.message : error}`,
        );
        return undefined;
      });
    return {
      cost,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      requests: usage?.requests,
      maxInputTokens: usage?.maxInputTokens,
      tokensPerSecond: usage?.tokensPerSecond,
      pod: handle.podId,
      podCosts,
      keptPod: keep ? handle.podId : undefined,
    };
  }

  /**
   * Terminates this repository's pods that serve nobody: no other run of the repository is
   * active while open-key runs, so a pod that is still starting or serving lost its run. Other
   * tasks' kept pods stay until their idle limit. Returns the task's kept pod, if it fits.
   */
  async #sweep(task: string, log: Log): Promise<{ pod: Pod; nonce: string } | undefined> {
    let kept: { pod: Pod; nonce: string } | undefined;
    for (const pod of await this.#host.list(podOwner(this.#options.repository))) {
      const nonce = pod.env.CODEMAN_NONCE ?? "";
      const handle = { podId: pod.id, nonce, url: this.#host.url(pod.id, GATEWAY_PORT) };
      const status = (await this.#admin(handle, "GET", "/admin/status").catch(() => undefined)) as
        | { ready?: boolean; serving?: boolean; lastActivity?: number }
        | undefined;
      const idle =
        status?.ready === true &&
        status.serving === false &&
        this.#now().getTime() - (status.lastActivity ?? 0) < KEPT_IDLE_MINUTES * 60_000;
      const fits =
        pod.env.CODEMAN_TASK === task &&
        pod.env.CODEMAN_MODEL === this.#settings.model &&
        pod.gpuType === this.#settings.gpuType &&
        pod.image === this.#settings.image;
      if (idle && fits && !kept) {
        kept = { pod, nonce };
      } else if (!idle || pod.env.CODEMAN_TASK === task) {
        const why = !idle ? "it serves no run of this repository" : "the task's settings changed";
        log.info(`Terminating pod ${pod.id} (task #${pod.env.CODEMAN_TASK ?? "?"}): ${why}.`);
        await this.#host.terminate(pod.id);
      }
    }
    return kept;
  }

  async #reuse(
    kept: { pod: Pod; nonce: string },
    run: RunRequest,
    token: string,
    log: Log,
  ): Promise<PodHandle> {
    const { pod, nonce } = kept;
    const pricePerSecond = pod.pricePerSecond ?? (await this.#host.price(this.#settings.gpuType));
    const handle: PodHandle = {
      mode: "pod",
      podId: pod.id,
      nonce,
      url: this.#host.url(pod.id, GATEWAY_PORT),
      start: this.#now().getTime(),
      pricePerSecond,
      reuse: this.#settings.reuse,
    };
    await this.#startRun(handle, run, token);
    log.info(`Reusing pod ${pod.id}, kept from the task's last run, for up to ${usd(run.limit)}.`);
    return handle;
  }

  async #create(run: RunRequest, token: string, log: Log): Promise<PodHandle> {
    const { model, gpuType, image, engine } = this.#settings;
    if (!image) throw new Error("No pod image is pinned; see docs/installation.md.");
    const listed = await this.#host.price(gpuType);
    const nonce = randomBytes(16).toString("hex");
    const now = this.#now();
    const pod = await this.#host.create({
      name: `codeman-${this.#options.repository.name}-${run.task}-${run.runId}`.slice(0, 100),
      image,
      env: {
        ...podOwner(this.#options.repository),
        CODEMAN_TASK: run.task,
        CODEMAN_RUN: run.runId,
        CODEMAN_NONCE: nonce,
        CODEMAN_MODEL: model,
        CODEMAN_ENGINE: engine.name,
        CODEMAN_ADMIN_SHA256: sha256(adminToken(this.#options.accountKey, nonce)),
        CODEMAN_START_BY: new Date(now.getTime() + START_MINUTES * 60_000).toISOString(),
        CODEMAN_KEPT_IDLE_MINUTES: String(KEPT_IDLE_MINUTES),
        CODEMAN_RUN_IDLE_MINUTES: String(RUN_IDLE_MINUTES),
      },
      port: GATEWAY_PORT,
      gpuType,
      diskGb: DISK_GB,
    });
    log.info(
      `Created pod ${pod.id} with ${gpuType}, at ${usd(listed * 3600)} per hour; waiting for ${model}.`,
    );
    const url = this.#host.url(pod.id, GATEWAY_PORT);
    try {
      const ready = await waitUntilReady(
        this.#host,
        pod.id,
        async () => {
          const response = await (this.#options.fetch ?? fetch)(`${url}/health`);
          return response.ok && ((await response.json()) as { ready?: boolean }).ready === true;
        },
        { timeoutMs: START_MINUTES * 60_000, wait: this.#options.wait },
      );
      const handle: PodHandle = {
        mode: "pod",
        podId: pod.id,
        nonce,
        url,
        // Billing starts with the pod, while it pulls the image and the model.
        start: pod.createdAt.getTime(),
        pricePerSecond: ready.pricePerSecond ?? pod.pricePerSecond ?? listed,
        reuse: this.#settings.reuse,
      };
      await this.#startRun(handle, run, token);
      const minutes = (this.#now().getTime() - handle.start) / 60_000;
      log.info(`Pod ${pod.id} serves ${model} after ${minutes.toFixed(1)} minutes.`);
      return handle;
    } catch (error) {
      await this.#host.terminate(pod.id);
      log.warning(
        `Terminated pod ${pod.id}, which did not serve ${model}; it cost about ${usd(podCost(pod.createdAt, this.#now(), listed))}.`,
      );
      throw error;
    }
  }

  async #startRun(handle: PodHandle, run: RunRequest, token: string): Promise<void> {
    await this.#admin(handle, "POST", "/admin/run", {
      tokenSha256: sha256(token),
      limit: run.limit,
      start: handle.start,
      pricePerSecond: handle.pricePerSecond,
    });
  }

  async #admin(
    handle: Pick<PodHandle, "url" | "nonce">,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await (this.#options.fetch ?? fetch)(`${handle.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${adminToken(this.#options.accountKey, handle.nonce)}`,
        ...(body === undefined && method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      body: method === "GET" ? null : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`The pod's gateway answered ${path} with ${response.status}.`);
    return response.json();
  }
}

/** Terminates a pod that `close` kept, once the task does not go on to another run. */
export async function releasePod(host: Pick<PodHost, "terminate">, text: string, log: Log) {
  const handle = parseHandle(text);
  if (handle.mode !== "pod") return;
  await host.terminate(handle.podId);
  log.info(`Terminated pod ${handle.podId}: the task does not go on to another run now.`);
}

export function parseHandle(text: string): PodHandle | ServerlessHandle {
  const handle = JSON.parse(text) as PodHandle | ServerlessHandle;
  if (handle.mode !== "pod" && handle.mode !== "serverless") {
    throw new Error("The handle is not a self-hosted run's.");
  }
  return handle;
}

/**
 * What the agent job's gateway needs to serve a Serverless run, and `close` to cost it. Holds no
 * secret: the endpoint's key reaches only the agent job's own step.
 */
export interface ServerlessHandle {
  mode: "serverless";
  endpoint: string;
  /** The endpoint's OpenAI-compatible API. */
  url: string;
  pricePerSecond: number;
  idleSeconds: number;
  limit: number;
  contextLength?: number | undefined;
}

export interface ServerlessSettings extends SelfHostedSettings {
  endpoint: string;
  /** Checks the endpoint's environment for serving `model`; empty when it can. */
  engineProblems(env: Record<string, string>, model: string): string[];
  contextLength(env: Record<string, string>): number | undefined;
}

/**
 * Self-hosted inference on a Serverless endpoint a maintainer created: the agent job runs the
 * gateway outside the sandbox, with the endpoint's key, and gives the agent a local URL and the
 * run's token. A run's cost is estimated from the gateway's measures, since the provider bills
 * endpoints by the hour. See docs/architecture.md#self-hosted-inference.
 */
export class ServerlessInference implements InferenceProvider {
  readonly name: string;
  readonly #settings: ServerlessSettings;
  readonly #gpu: GpuProvider;
  readonly #host: ServerlessHost;
  readonly #usage: string;
  readonly #now: () => Date;

  /** `usage` is what the agent job's gateway reported, as JSON; empty when it reported nothing. */
  constructor(
    settings: ServerlessSettings,
    gpu: GpuProvider,
    options: { usage?: string; now?: () => Date } = {},
  ) {
    if (!gpu.serverless) throw new Error(`${gpu.name} has no Serverless endpoints.`);
    this.name = `${gpu.name} Serverless`;
    this.#settings = settings;
    this.#gpu = gpu;
    this.#host = gpu.serverless;
    this.#usage = options.usage ?? "";
    this.#now = options.now ?? (() => new Date());
  }

  async taskSpent(): Promise<number> {
    return this.#settings.taskSpent;
  }

  async monthSpent(): Promise<number> {
    return this.#gpu.monthSpent(this.#now());
  }

  /** Checks the endpoint (decision 10 of the plan) and prices its workers. */
  async open(run: RunRequest, log: Log): Promise<OpenedRun> {
    const { endpoint: id, model } = this.#settings;
    const endpoint = await this.#host.endpoint(id);
    const problems = [
      ...endpointProblems(endpoint),
      ...this.#settings.engineProblems(endpoint.env, model),
    ];
    if (problems.length > 0) {
      throw new Error(`Serverless endpoint ${id} cannot serve this run: ${problems.join("; ")}.`);
    }
    const handle: ServerlessHandle = {
      mode: "serverless",
      endpoint: id,
      url: this.#host.openAiUrl(id),
      pricePerSecond: await this.#host.price(id),
      idleSeconds: endpoint.idleTimeoutSeconds ?? 0,
      limit: run.limit,
      contextLength: this.#settings.contextLength(endpoint.env),
    };
    log.info(
      `Endpoint ${id} serves ${model}, at up to ${usd(handle.pricePerSecond * 3600)} per worker-hour; the run may use ${usd(run.limit)}.`,
    );
    return {
      handle: JSON.stringify(handle),
      // The agent's token for the agent job's gateway, which holds the endpoint's key.
      credential: randomBytes(32).toString("base64url"),
      contextLength: handle.contextLength,
    };
  }

  /**
   * Costs the run from what the agent job's gateway measured: its workers' busy time at the
   * endpoint's price. Without a report, such as after a cancelled job, the run counts its whole
   * limit, so the task's budget never counts less than was spent.
   */
  async close(text: string, log: Log): Promise<RunUsage> {
    const handle = parseHandle(text);
    if (handle.mode !== "serverless") throw new Error("The handle is not a Serverless run's.");
    const usage = parseUsage(this.#usage);
    if (!usage) {
      log.warning(
        `The agent job reported no usage; the run counts its whole limit, ${usd(handle.limit)}.`,
      );
      return { cost: handle.limit };
    }
    return {
      cost: usage.cost,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      requests: usage.requests,
      maxInputTokens: usage.maxInputTokens,
      tokensPerSecond: usage.tokensPerSecond,
    };
  }
}

/** The gateway's usage report, as the agent job outputs it; undefined when missing or invalid. */
export function parseUsage(text: string): GatewayUsage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const usage = value as Partial<GatewayUsage> | null;
  const finite = (field: unknown) =>
    typeof field === "number" && Number.isFinite(field) && field >= 0;
  if (!usage || !finite(usage.cost) || !finite(usage.requests)) return undefined;
  if (!finite(usage.inputTokens) || !finite(usage.outputTokens)) return undefined;
  return usage as GatewayUsage;
}
