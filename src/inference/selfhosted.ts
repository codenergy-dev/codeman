import { createHmac, randomBytes } from "node:crypto";
import { usd } from "../budget.ts";
import { type EndedRun, GATEWAY_VERSION, sha256 } from "../gateway/gateway.ts";
import { type FitReport, GATEWAY_PORT } from "../gateway/pod.ts";
import type { GatewayUsage, Span } from "../gateway/usage.ts";
import type { VllmFitReport } from "../gateway/vllm.ts";
import type { RepositoryRef } from "../platform/types.ts";
import { type Pool, soloPool } from "../pool.ts";
import type { Log } from "../runtime/runtime.ts";
import { LAYOUT, repositoryName } from "../store/layout.ts";
import type { Store } from "../store/store.ts";
import type { InferenceEngine } from "./engine.ts";
import {
  DEFAULT_HOSTS,
  endpointProblems,
  type GpuProvider,
  type HostKind,
  type Pod,
  type PodHost,
  PodStartFailure,
  type PodStatus,
  podCost,
  type ServerlessHost,
  waitUntilReady,
} from "./gpu.ts";
import { HuggingFace, type ModelHub } from "./huggingface.ts";
import { IMAGES_WITHOUT_OLLAMA_SETTINGS, OLLAMA_VERSION, SINGLE_RUN_IMAGES } from "./ollama.ts";
import {
  ConcurrencyReached,
  type InferenceProvider,
  type OpenedRun,
  OpenFailure,
  type PodEvent,
  type PodLife,
  type RunRequest,
  type RunUsage,
} from "./provider.ts";
import {
  type Change,
  CREATE_LEASE_MS,
  heldBy,
  type PodDescription,
  PodRegistry,
  type RegisteredPod,
  registered,
} from "./registry.ts";
import { VLLM_MIN_CUDA } from "./vllm.ts";

/** How long a new pod has to pull its image and model and serve it. */
export const START_MINUTES = 25;
/** How long a kept pod waits for a task's next run, and a task's keep lease lasts. */
export const KEPT_IDLE_MINUTES = 15;
/** A run whose agent sends no request for this long has lost it. */
export const RUN_IDLE_MINUTES = 30;
/** How often a task waiting for another to create the pod of its settings looks again. */
export const CLAIM_POLL_MS = 10_000;
/**
 * The start of the registry's reason for a pod whose gateway reported its start failed, before
 * the failure's message: the tasks that joined the pod read it there once the pod is gone.
 */
const START_FAILED = "its start failed: ";
/** Claims a task makes before it gives up: its waits for a creation lease, and pods it could not join. */
const CLAIMS = Math.ceil(CREATE_LEASE_MS / CLAIM_POLL_MS) + 10;
/** Container disk of a pod, in GB: the model and Ollama's image; the least a vLLM pod gets. */
const DISK_GB = 80;
/** A vLLM pod's disk beside the model's weights, in GB: vLLM's image, unpacked, and its caches. */
const VLLM_BASE_DISK_GB = 40;
/** Room a vLLM pod's disk leaves beyond the model's weights, as a share of them. */
const VLLM_DISK_SPARE = 0.25;
/**
 * Shared memory a vLLM pod asks for, in GB, where the provider sets it per container: vLLM's
 * Docker guide runs it with the host's (`--ipc=host`), and Salad's default is 64 MB.
 */
const VLLM_SHARED_MEMORY_GB = 8;
/** Billing is read this far back; older pods have left the spend table's refreshed rows. */
const BILLING_DAYS = 30;
/** Tries of `/admin/end` at a run's close, and the wait between two. */
export const END_ATTEMPTS = 3;
export const END_RETRY_MS = 5_000;

/** What a task's self-hosted runs use, as `select` resolved it from the settings. */
export interface SelfHostedSettings {
  /** The engine's model name. */
  model: string;
  engine: InferenceEngine;
  /** The pods the task's record lists, whose billing refreshes its spend. */
  pods: readonly string[];
}

export interface PodSettings extends SelfHostedSettings {
  gpuType: string;
  /** The pod image, by digest. */
  image: string;
  /** `task`: a pod serves the next runs on its settings too; `run`: it ends with its runs. */
  reuse: "task" | "run";
  /**
   * The Ollama server's variables from the `ollama` settings, such as `{ OLLAMA_NUM_PARALLEL:
   * "4" }`, sorted (`ollamaEnvironment`); none when undefined or empty.
   */
  ollama?: Readonly<Record<string, string>> | undefined;
  /**
   * The vLLM settings, by key, such as `{ "tool-call-parser": "qwen3_xml" }`, sorted
   * (`checkedVllm`); with the engine `vllm` only.
   */
  vllm?: Readonly<Record<string, string>> | undefined;
  /**
   * The most tasks the run's profile serves at once, which `num-parallel` defaults to on images
   * that fit the model to the GPU (choices 5 and 6 of the plan for fitting Ollama to the GPU), and
   * `max-num-seqs` with vLLM.
   */
  parallel?: number | undefined;
  /** The batch the task runs in, whose pod it joins first. */
  batch?: string | undefined;
  /**
   * The kinds of host the pod may run on, by preference (decision 1 of the plan for Salad pods);
   * `DEFAULT_HOSTS` when undefined.
   */
  hosts?: readonly HostKind[] | undefined;
  /** The pod's priority, as its provider names it; the provider's highest when undefined. */
  priority?: string | undefined;
  /**
   * The run's batch key, and how many live pods of it may run at once (decision 4 of the plan
   * for limiting concurrent instances of a profile); undefined: no cap.
   */
  concurrency?: { key: string; pods: number } | undefined;
}

/** Whether pod settings serve their model with vLLM. */
function onVllm(settings: Pick<PodSettings, "engine">): boolean {
  return settings.engine.name === "vllm";
}

/**
 * The vLLM settings a pod gets: `max-num-seqs` defaults to the most tasks the run's profile
 * serves, and the settings' own win (decision 3 of the plan for vLLM on pods). Sorted by key.
 */
export function podVllm(settings: Pick<PodSettings, "vllm" | "parallel">): Record<string, string> {
  const derived =
    settings.parallel === undefined ? {} : { "max-num-seqs": String(settings.parallel) };
  return Object.fromEntries(
    Object.entries({ ...derived, ...settings.vllm }).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  );
}

/**
 * A vLLM pod's container disk, in GB: its model's weights with room to spare, and vLLM's image
 * and caches; 80 GB at least (decision 10 of the plan for vLLM on pods).
 */
export function vllmDiskGb(weightsBytes: number): number {
  return Math.max(
    DISK_GB,
    Math.ceil((weightsBytes / 1e9) * (1 + VLLM_DISK_SPARE) + VLLM_BASE_DISK_GB),
  );
}

/** What `close` needs to find a pod run again. Travels in plain text between jobs. */
export interface PodHandle {
  mode: "pod";
  podId: string;
  /** Names the pod's admin token, which only the account key derives, and its registry document. */
  nonce: string;
  url: string;
  /** When the run's cost started: a new pod's creation, or a kept pod's new run. */
  start: number;
  /** When the pod was created; its whole life counts in the task's spend. */
  created?: number | undefined;
  pricePerSecond: number;
  /**
   * What the run may spend, in USD, which caps its cost on a shared pod when the gateway does not
   * report it; none in handles from before it.
   */
  limit?: number | undefined;
  reuse: "task" | "run";
  /** The task's lease in the pod registry: `owner/name#7`. */
  holder: string;
  /**
   * On a pod that serves several tasks: the task's seat on the pod, which names its runs on the
   * gateway, and its token's hash, which names this run. The hash of 32 random bytes tells
   * nothing of the token.
   */
  shared?: { task: string; tokenSha256: string } | undefined;
  /** Set when the pod's model reads images, which the agent job tells the harness. */
  vision?: true | undefined;
}

/** A task's name in the pod registry, across the organization's repositories: `owner/name#7`. */
export function leaseHolder(repository: RepositoryRef, task: string): string {
  return `${repositoryName(repository)}#${task}`;
}

/** Whether the image's gateway serves one run at a time, as before shared pods. */
export function servesOneRun(image: string): boolean {
  return SINGLE_RUN_IMAGES.has(image);
}

/**
 * Whether the image's gateway applies Ollama settings and fits the model to the GPU: every image
 * but those pinned before Ollama settings (choice 6 of the plan for fitting Ollama to the GPU).
 */
export function fitsTheGpu(image: string): boolean {
  return !IMAGES_WITHOUT_OLLAMA_SETTINGS.has(image);
}

/**
 * The Ollama variables a pod gets: on an image that fits the model to the GPU, `num-parallel`
 * defaults to the most tasks the run's profile serves, and the settings' own win; on an older
 * image, the settings' own only, which it refuses. Sorted by variable.
 */
export function podOllama(
  settings: Pick<PodSettings, "ollama" | "parallel" | "image">,
): Record<string, string> {
  const own = settings.ollama ?? {};
  const derived =
    fitsTheGpu(settings.image) && settings.parallel !== undefined
      ? { OLLAMA_NUM_PARALLEL: String(settings.parallel) }
      : {};
  const variables = { ...derived, ...own };
  return Object.fromEntries(
    Object.entries(variables).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * The key of a pod's settings in the cache of fits (choice 9 of the plan for fitting Ollama to
 * the GPU): the image, the model, the GPU type, and every Ollama variable but the context
 * length, which the cache stands in for.
 */
export function fitKey(
  settings: Pick<PodSettings, "image" | "model" | "gpuType" | "ollama"> &
    Partial<Pick<PodSettings, "engine" | "vllm">>,
): string {
  // A vLLM pod's: its engine and every vLLM setting but the context (decision 9 of the plan for
  // vLLM on pods).
  const variables =
    settings.engine && onVllm({ engine: settings.engine })
      ? [
          "engine vllm",
          ...vllmValues(settings).filter((value) => !value.startsWith("max-model-len=")),
        ]
      : ollamaVariables(settings).filter(
          (variable) => !variable.startsWith("OLLAMA_CONTEXT_LENGTH="),
        );
  return sha256([settings.image, settings.model, settings.gpuType, ...variables].join("\n")).slice(
    0,
    32,
  );
}

/** The vLLM settings of pod settings, as `key=value`; empty without any. */
function vllmValues(settings: Partial<Pick<PodSettings, "vllm">>): string[] {
  return Object.entries(settings.vllm ?? {}).map(([key, value]) => `${key}=${value}`);
}

/** The Ollama variables of pod settings, as `VARIABLE=value`; empty without any. */
function ollamaVariables(settings: Pick<PodSettings, "ollama">): string[] {
  return Object.entries(settings.ollama ?? {}).map(([name, value]) => `${name}=${value}`);
}

/** The Ollama variables of pod settings, for messages: `` `OLLAMA_NUM_PARALLEL=4` ``. */
function quotedVariables(settings: Pick<PodSettings, "ollama">): string {
  return ollamaVariables(settings)
    .map((variable) => `\`${variable}\``)
    .join(", ");
}

/**
 * The hash of the settings a pod serves, which the pool's tasks with the same settings
 * share it by. On an image that serves one run at a time, the task is one of them: it gets a pod
 * of its own. Ollama settings are part of them, only when there are some, so pods without any
 * keep their hash (choice 9 of the Ollama settings plan); a vLLM pod's has its engine and its
 * vLLM settings (decision 9 of the plan for vLLM on pods). Its kinds of host and its priority
 * are part of them only when not the defaults, so pods from before them keep their hash.
 */
export function podSettingsKey(
  settings: Pick<PodSettings, "model" | "gpuType" | "image" | "reuse" | "ollama"> &
    Partial<Pick<PodSettings, "engine" | "vllm" | "hosts" | "priority">>,
  holder: string,
): string {
  const { model, gpuType, image, reuse, priority } = settings;
  const ollama = ollamaVariables(settings);
  const vllm = settings.engine && onVllm({ engine: settings.engine });
  const hosts = (settings.hosts ?? DEFAULT_HOSTS).join(",");
  const parts = [
    model,
    gpuType,
    image,
    reuse,
    ...(servesOneRun(image) ? [holder] : []),
    ...(ollama.length > 0 ? [`ollama ${ollama.join(" ")}`] : []),
    ...(vllm ? ["engine vllm", `vllm ${vllmValues(settings).join(" ")}`] : []),
    ...(hosts !== DEFAULT_HOSTS.join(",") ? [`hosts ${hosts}`] : []),
    ...(priority !== undefined ? [`priority ${priority}`] : []),
  ];
  return sha256(parts.join("\n")).slice(0, 16);
}

/**
 * Whether a pod carries Codeman's environment for the organization: `CODEMAN_ORGANIZATION`, or
 * `CODEMAN_REPOSITORY` of one of its repositories, which pods created before the registry carry.
 * Codeman never terminates another pod as an orphan.
 */
export function ofOrganization(pod: Pick<Pod, "env">, owner: string): boolean {
  const organization = pod.env.CODEMAN_ORGANIZATION ?? pod.env.CODEMAN_REPOSITORY?.split("/")[0];
  return organization !== undefined && organization.toLowerCase() === owner.toLowerCase();
}

/**
 * Whether a pod is the pool's: it carries the pool's `CODEMAN_POOL`, or, from before pools, no
 * pool and the organization's environment (decision 15 of the plan for GPU batches across
 * repositories).
 */
export function ofPool(pod: Pick<Pod, "env">, pool: string, owner: string): boolean {
  const named = pod.env.CODEMAN_POOL;
  return named ? named.toLowerCase() === pool.toLowerCase() : ofOrganization(pod, owner);
}

/** The pool of another pod the organization created, which only that pool's registry holds. */
export function otherPoolOf(
  pod: Pick<Pod, "env">,
  pool: string,
  owner: string,
): string | undefined {
  const named = pod.env.CODEMAN_POOL?.toLowerCase();
  if (!named || named === pool.toLowerCase()) return undefined;
  return pod.env.CODEMAN_ORGANIZATION?.toLowerCase() === owner.toLowerCase() ? named : undefined;
}

/**
 * The GPU account's fingerprint, which a pod's document and environment carry so that a task
 * joins only pods its account runs: an HMAC of a fixed label with the account key, never the key.
 */
export function accountFingerprint(accountKey: string): string {
  return createHmac("sha256", accountKey)
    .update("codeman-account-fingerprint")
    .digest("hex")
    .slice(0, 16);
}

/**
 * How many runs a pod of these settings serves at once: the parallel requests its engine gets,
 * when it gets some; undefined (no limit) on images that get neither.
 */
export function podCapacity(settings: Pick<PodSettings, "ollama" | "vllm">): number | undefined {
  const text = settings.ollama?.OLLAMA_NUM_PARALLEL ?? settings.vllm?.["max-num-seqs"];
  const value = Number(text);
  return text !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
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

/**
 * What a pod's gateway says of itself, from `/admin/status`; older gateways lack the runs, and
 * the Ollama variables they applied.
 */
interface GatewayStatus {
  version?: number;
  ready?: boolean;
  contextLength?: number;
  ollama?: Record<string, unknown>;
  /** The vLLM settings it applied, by key, from gateways that serve vLLM. */
  vllm?: Record<string, unknown>;
  /** How the model fits the GPU, from gateways that check it. */
  fit?: FitReport | VllmFitReport;
  /** Why the model could not be served. */
  failure?: string;
}

/** A pod's gateway, as the key jobs reach it: its URL and the nonce of its admin token. */
type GatewayTarget = Pick<PodHandle, "url" | "nonce">;

/** Calls a pod gateway's admin route with the token the account key derives for it. */
async function callGateway(
  fetchFn: typeof fetch,
  accountKey: string,
  target: GatewayTarget,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetchFn(`${target.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken(accountKey, target.nonce)}`,
      ...(body === undefined && method === "GET" ? {} : { "Content-Type": "application/json" }),
    },
    body: method === "GET" ? null : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`The pod's gateway answered ${path} with ${response.status}.`);
  return response.json();
}

export interface SelfHostedOptions {
  repository: RepositoryRef;
  gpu: GpuProvider;
  accountKey: string;
  /** Codeman's store, which holds the pod registry. */
  store: Store;
  /** The pool whose registry the pods are in; the organization alone when undefined. */
  pool?: Pool | undefined;
  now?: () => Date;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  /** Where a vLLM pod's model is checked and sized: Hugging Face's API by default. */
  hub?: ModelHub;
}

/**
 * Self-hosted inference on pods: each run gets a token for a gateway in a pod that serves the
 * task's model. The pool's tasks with the same pod settings share one pod, which they
 * find, create, keep and leave through the pod registry, each with its own run and share of the
 * pod. See docs/inference/pods.md.
 */
export class PodInference implements InferenceProvider {
  readonly name: string;
  readonly #settings: PodSettings;
  /** The `ollama` settings' own variables, without the derived ones. */
  readonly #own: Readonly<Record<string, string>>;
  readonly #options: SelfHostedOptions;
  readonly #host: PodHost;
  readonly #registry: PodRegistry;
  readonly #pool: Pool;
  readonly #account: string;
  /** What this provider did with pods since `open` or `close` last reported it. */
  #events: PodEvent[] = [];

  constructor(settings: PodSettings, options: SelfHostedOptions) {
    if (!options.gpu.pods) throw new Error(`${options.gpu.name} has no pods.`);
    this.name = `${options.gpu.name} pods`;
    this.#own = settings.ollama ?? {};
    this.#settings = onVllm(settings)
      ? { ...settings, ollama: {}, vllm: podVllm(settings) }
      : { ...settings, ollama: podOllama(settings), vllm: undefined };
    this.#options = options;
    this.#host = options.gpu.pods;
    this.#pool = options.pool ?? soloPool(options.repository.owner);
    this.#account = accountFingerprint(options.accountKey);
    this.#registry = new PodRegistry(options.store, this.#pool.id, () => this.#now());
  }

  /** The pod events so far, which the caller reports. */
  #takeEvents(): PodEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  /**
   * Refuses, before any pod, an image known not to apply Ollama settings when the run has some:
   * a requested setting is never dropped (choice 8 of the Ollama settings plan).
   */
  #checkImage(log: Log): void {
    const own = { ollama: this.#own };
    const { image, parallel } = this.#settings;
    if (onVllm(this.#settings)) {
      if (image) return;
      throw new Error(
        "This version of Codeman pins no vLLM pod image yet (`POD_IMAGES` in src/inference/images.ts), so no pod was created: use a version that pins one, or `engine: ollama`. See docs/settings/vllm.md#pod-images.",
      );
    }
    if (fitsTheGpu(image)) return;
    if (ollamaVariables(own).length > 0) {
      throw new Error(
        `The pod image ${image} cannot apply Ollama settings (${quotedVariables(own)}), so no pod was created: use a version of Codeman whose pod image can, or remove \`ollama\` from the settings. See docs/settings/ollama.md#pod-images.`,
      );
    }
    if (parallel !== undefined) {
      log.info(
        `The pod image ${image} predates Ollama settings: its pods serve one request at a time, with the model's own context length, and nothing checks that the model fits the GPU. See docs/settings/ollama.md#pod-images.`,
      );
    }
  }

  async open(run: RunRequest, log: Log): Promise<OpenedRun> {
    const token = randomBytes(32).toString("base64url");
    const holder = leaseHolder(this.#options.repository, run.task);
    const settings = podSettingsKey(this.#settings, holder);
    let handle: PodHandle;
    try {
      this.#checkImage(log);
      await this.#sweep(holder, settings, log);
      handle = await this.#claim(run, holder, settings, token, log);
    } catch (error) {
      if (error instanceof ConcurrencyReached) throw error;
      throw new OpenFailure(error, this.#takeEvents());
    }
    // The context and images are informational: a failure to read them does not undo the run.
    const status = (await this.#admin(handle, "GET", "/admin/status").catch(
      () => ({}),
    )) as GatewayStatus;
    if (await this.#readsImages(handle.podId, status, log)) handle = { ...handle, vision: true };
    const pods = this.#takeEvents();
    if (!pods.some(({ pod, event }) => pod === handle.podId && event === "created")) {
      pods.push({ pod: handle.podId, event: "joined" });
    }
    return {
      handle: JSON.stringify(handle),
      credential: token,
      baseUrl: `${handle.url}/v1`,
      contextLength: status.contextLength,
      pods,
    };
  }

  /**
   * Whether the agent is told its model reads images (the plan for letting self-hosted models read
   * images): with vLLM, when the model's configuration has a vision tower that the settings do not
   * skip; with Ollama, when the gateway's fit says Ollama lists the `vision` capability. When it
   * cannot tell, text only: images sent to a model that cannot read them would fail its requests.
   */
  async #readsImages(podId: string, status: GatewayStatus, log: Log): Promise<boolean> {
    const { model } = this.#settings;
    const textOnly = "the agent reads text only.";
    if (!onVllm(this.#settings)) {
      const vision = status.fit?.engine === undefined ? status.fit?.vision : undefined;
      log.info(
        vision === undefined
          ? `Pod ${podId}'s gateway does not say whether ${model} reads images: ${textOnly}`
          : vision
            ? `Ollama lists the vision capability of ${model}: the agent reads images.`
            : `Ollama does not list the vision capability of ${model}: ${textOnly}`,
      );
      return vision === true;
    }
    if (this.#settings.vllm?.["language-model-only"] === "true") {
      log.info(
        `\`language-model-only\` keeps vLLM from serving ${model}'s vision tower: ${textOnly}`,
      );
      return false;
    }
    const hub = this.#options.hub ?? new HuggingFace(this.#options.fetch);
    let vision: boolean;
    try {
      vision = await hub.vision(model);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.info(
        `Could not tell whether ${model} reads images: ${reason} The agent reads text only.`,
      );
      return false;
    }
    log.info(
      vision
        ? `${model}'s configuration on Hugging Face has a vision tower, which vLLM serves: the agent reads images.`
        : `${model}'s configuration on Hugging Face has no vision tower: ${textOnly}`,
    );
    return vision;
  }

  /**
   * Ends the run on the pod and reads what it used, then keeps the pod for the next runs on its
   * settings (a keep lease) or leaves it; a pod that no run uses and no task keeps is terminated.
   * A run alone on its pod costs the pod's time since it started; a run on a shared pod, its
   * share, and the task counts what the gateway gave it of the pod: Runpod bills the pod whole.
   */
  async close(text: string, log: Log): Promise<RunUsage> {
    const handle = parseHandle(text);
    if (handle.mode !== "pod") throw new Error("The handle is not a pod run's.");
    const { shared } = handle;
    const ended = await this.#endRun(handle, log);
    const keep = handle.reuse === "task" && ended !== undefined;
    await this.#leave(handle, keep, ended === undefined, log);
    const now = this.#now();
    const usage = { ...tokens(ended), pod: handle.podId, keptPod: keep ? handle.podId : undefined };
    if (shared) {
      const share = ended?.share;
      const billed = await this.#billing(this.#settings.pods, now, log);
      const podCosts = { ...billed };
      if (share) podCosts[handle.podId] = Number(share.taskCost.toFixed(6));
      return {
        ...usage,
        cost: ended?.cost ?? estimatedShare(handle, now, log),
        podCosts,
        podShared: true,
        pods: this.#takeEvents(),
      };
    }
    const billed = await this.#billing([...this.#settings.pods, handle.podId], now, log);
    // Runpod bills a running pod late, so the pod also counts for its whole life so far,
    // including a kept pod's time between runs; its billing wins once higher.
    const lifetime =
      handle.created === undefined
        ? undefined
        : podCost(new Date(handle.created), now, handle.pricePerSecond);
    const podCosts = billed === undefined && lifetime === undefined ? undefined : { ...billed };
    if (podCosts && lifetime !== undefined) {
      podCosts[handle.podId] = Number(Math.max(podCosts[handle.podId] ?? 0, lifetime).toFixed(6));
    }
    return {
      ...usage,
      cost: podCost(new Date(handle.start), now, handle.pricePerSecond),
      podCosts,
      pods: this.#takeEvents(),
    };
  }

  /**
   * Ends the run on its pod's gateway and reads what it used. `/admin/end` returns the same usage
   * when called again, so a failed call is tried again, `END_ATTEMPTS` times in all: the
   * provider's proxy or the pod may fail for a moment. Undefined when the gateway never answers,
   * or does not know the run, as after its restart.
   */
  async #endRun(handle: PodHandle, log: Log): Promise<EndedRun | undefined> {
    const { shared } = handle;
    const body = shared
      ? { tokenSha256: shared.tokenSha256, keep: handle.reuse === "task" }
      : undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        const ended = (await this.#admin(handle, "POST", "/admin/end", body)) as EndedRun | null;
        if (!ended) {
          log.warning(
            `Pod ${handle.podId}'s gateway does not know this run, as after a restart: it reported no usage.`,
          );
        }
        return ended ?? undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= END_ATTEMPTS) {
          log.warning(
            `Could not read the run's usage from its pod after ${END_ATTEMPTS} tries: ${message}`,
          );
          return undefined;
        }
        log.info(`Could not end the run on its pod (${message}); trying again.`);
        await this.#wait(END_RETRY_MS);
      }
    }
  }

  /**
   * Replaces the run's lease with a keep lease, or drops it, and terminates the pod when no other
   * lease holds it. A pod whose gateway did not answer takes no other task. When the registry
   * cannot be reached, the pod stays: it terminates itself once no run uses it.
   */
  async #leave(handle: PodHandle, keep: boolean, unreachable: boolean, log: Log): Promise<void> {
    let left: Awaited<ReturnType<PodRegistry["leave"]>>;
    try {
      left = await this.#registry.leave(handle.nonce, handle.holder, {
        keepUntil: keep ? new Date(this.#now().getTime() + KEPT_IDLE_MINUTES * 60_000) : undefined,
        abandon: unreachable,
      });
    } catch (error) {
      log.warning(
        `Could not leave pod ${handle.podId} in the pod registry (${error instanceof Error ? error.message : error}); it terminates itself once no run uses it, after ${KEPT_IDLE_MINUTES} idle minutes.`,
      );
      return;
    }
    if (left.ended) {
      this.#events.push(
        await terminatePod(this.#host, handle.podId, left.pod?.pod ? left.pod : undefined, {
          reason: "no run uses it and no task keeps it",
          life: lifeOf(handle, this.#options.gpu.name, this.#now()),
          log,
        }),
      );
    } else if (keep) {
      const next = handle.shared ? "the next runs on its settings" : "the task's next run";
      log.info(`Kept pod ${handle.podId} for ${next}, for ${KEPT_IDLE_MINUTES} minutes at most.`);
    } else if (left.holders.length > 0) {
      log.info(`Left pod ${handle.podId} to ${tasksOn(left.holders)}.`);
    } else {
      log.info(`Pod ${handle.podId} had already left the pod registry.`);
    }
  }

  /**
   * What the provider billed for these pods; undefined when it could not be read, or when the
   * provider has no billing.
   */
  async #billing(
    pods: readonly string[],
    now: Date,
    log: Log,
  ): Promise<Record<string, number> | undefined> {
    if (!this.#host.billing) return undefined;
    return this.#host
      .billing([...new Set(pods)], new Date(now.getTime() - BILLING_DAYS * 86_400_000))
      .catch((error: unknown) => {
        log.warning(
          `Could not read the pods' billing: ${error instanceof Error ? error.message : error}`,
        );
        return undefined;
      });
  }

  /**
   * Terminates the pool's pods that nothing holds (step 3 of the pod registry plan), and
   * drops this task's keep leases on pods of other settings. Pods are listed before the registry
   * is read, and a task writes a pod's document before it creates the pod, so a pod being created
   * is always held. A pod without Codeman's environment, of another pool and organization, or of
   * another account is never touched (decision 15 of the plan for GPU batches across repositories).
   */
  async #sweep(holder: string, settings: string, log: Log): Promise<void> {
    const owner = this.#options.repository.owner;
    const pool = this.#pool.id;
    const all = await this.#host.list({});
    const listed = all.filter((pod) => ofPool(pod, pool, owner));
    const statuses = new Map<string, PodStatus | "missing">();
    for (const pod of listed) statuses.set(pod.id, pod.status);
    const held = new Map<string, RegisteredPod>();
    const terminated = new Set<string>();
    for (const record of await this.#registry.live(this.#account)) {
      if (record.pod && !statuses.has(record.pod)) {
        statuses.set(record.pod, (await this.#host.get(record.pod))?.status ?? "missing");
      }
      const decide = (pod: RegisteredPod, now: Date) =>
        sweepChange(pod, {
          now,
          holder,
          settings,
          status: pod.pod ? statuses.get(pod.pod) : undefined,
        });
      const changed = decide(record, this.#now())
        ? await this.#registry.change(record.nonce, decide)
        : { pod: record, change: undefined };
      const { pod, change } = changed;
      if (pod?.live) held.set(pod.nonce, pod);
      if (!pod || !change?.end) continue;
      const status = pod.pod ? statuses.get(pod.pod) : undefined;
      if (pod.pod && status !== "missing" && status !== "terminated") {
        terminated.add(pod.pod);
        this.#events.push(
          await terminatePod(this.#host, pod.pod, pod, {
            reason: change.end,
            log,
            provider: this.#options.gpu.name,
            now: this.#now(),
          }),
        );
      } else if (pod.pod) {
        log.info(`Pod ${pod.pod} left the pod registry: it no longer exists.`);
      }
    }
    for (const pod of listed) {
      if (terminated.has(pod.id) || pod.status === "terminated") continue;
      const record = held.get(pod.env.CODEMAN_NONCE ?? "");
      if (record && (record.pod === pod.id || (record.status === "creating" && !record.pod))) {
        continue;
      }
      this.#events.push(
        await terminatePod(this.#host, pod.id, undefined, {
          reason: "it carries Codeman's environment, and the pod registry does not hold it",
          log,
          life: pod.pricePerSecond
            ? {
                record: pod.env.CODEMAN_NONCE || pod.id,
                provider: this.#options.gpu.name,
                from: pod.createdAt.getTime(),
                to: this.#now().getTime(),
                pricePerSecond: pod.pricePerSecond,
              }
            : undefined,
        }),
      );
    }
    // Pods this organization created for another pool, such as one it declared before: only
    // when that pool's registry does not hold them either.
    for (const pod of all) {
      const other = otherPoolOf(pod, pool, owner);
      if (!other || terminated.has(pod.id) || pod.status === "terminated") continue;
      const nonce = pod.env.CODEMAN_NONCE ?? "";
      const document = nonce ? await this.#options.store.get(LAYOUT.pod(other, nonce)) : undefined;
      if (document && registered(document).live) continue;
      this.#events.push(
        await terminatePod(this.#host, pod.id, undefined, {
          reason: `this organization created it for pool ${other}, whose pod registry does not hold it`,
          log,
          life: pod.pricePerSecond
            ? {
                record: nonce || pod.id,
                provider: this.#options.gpu.name,
                from: pod.createdAt.getTime(),
                to: this.#now().getTime(),
                pricePerSecond: pod.pricePerSecond,
              }
            : undefined,
        }),
      );
    }
  }

  /**
   * Gives the run the pod of its settings: joins the one serving them, or creates it, or waits
   * while another task creates it. A pod the task cannot join takes no other task, and the task
   * claims again, which creates another.
   */
  async #claim(
    run: RunRequest,
    holder: string,
    settings: string,
    token: string,
    log: Log,
  ): Promise<PodHandle> {
    const { model, gpuType, image, reuse } = this.#settings;
    const capacity = podCapacity(this.#settings);
    const { batch, concurrency } = this.#settings;
    const description: PodDescription = {
      settings,
      model,
      gpuType,
      image,
      reuse,
      provider: this.#options.gpu.name,
      account: this.#account,
      organization: this.#options.repository.owner.toLowerCase(),
      ...(capacity === undefined ? {} : { capacity }),
      ...(batch === undefined ? {} : { batch }),
      ...(concurrency === undefined ? {} : { key: concurrency.key }),
    };
    let waiting = false;
    for (let claims = 0; claims < CLAIMS; claims++) {
      const claim = await this.#registry.claim(
        description,
        holder,
        run.runId,
        run.reservationMs,
        concurrency?.pods,
      );
      if (claim.kind === "full") {
        throw new ConcurrencyReached(
          `Every pod of these settings is full, and ${claim.pods} of them run, as many as \`concurrency\` allows: no pod was created.`,
          claim.pods,
          this.#takeEvents(),
        );
      }
      if (claim.kind === "wait") {
        if (!waiting)
          log.info("Another task is creating the pod for these settings; waiting for it.");
        waiting = true;
        await this.#wait(CLAIM_POLL_MS);
        continue;
      }
      if (claim.kind === "create") {
        const handle = await this.#create(claim.pod, run, holder, token, log);
        if (handle) return handle;
        continue;
      }
      try {
        return await this.#attach(claim.pod, run, token, holder, claim.seat, false, log);
      } catch (error) {
        // It failed to start, or it no longer answers: no task joins it any more.
        log.warning(
          `Could not join pod ${claim.pod.pod}: ${error instanceof Error ? error.message : error}`,
        );
        const left = await this.#registry.leave(claim.pod.nonce, holder, { abandon: true });
        if (left.ended && claim.pod.pod) {
          this.#events.push(
            await terminatePod(this.#host, claim.pod.pod, claim.pod, {
              reason: "no run uses it and no task keeps it",
              log,
              provider: this.#options.gpu.name,
              now: this.#now(),
            }),
          );
        }
        // Another pod of the same settings would fail the same way (choice 12).
        if (error instanceof PodStartFailure) throw error;
        // Its creator read the failure first, and terminated it.
        const failed = startFailure(left.pod);
        if (failed) throw failed;
      }
    }
    throw new Error(
      `Found no pod for ${model} on ${gpuType} to join or create after ${CLAIMS} tries.`,
    );
  }

  /**
   * Creates the pod the task holds the creation lease of, and starts the run on it once it
   * serves the model. Undefined when another task took the lease meanwhile: the pod is then
   * terminated, and the task claims again.
   */
  async #create(
    record: RegisteredPod,
    run: RunRequest,
    holder: string,
    token: string,
    log: Log,
  ): Promise<PodHandle | undefined> {
    let launched: { pod: Pod; listed: number };
    try {
      launched = await this.#launch(record, log);
    } catch (error) {
      await this.#registry.end(record.nonce, "the provider did not create it");
      throw error;
    }
    const { pod, listed } = launched;
    const registered = await this.#registry.register(record.nonce, {
      pod: pod.id,
      createdAt: pod.createdAt,
      pricePerSecond: pod.pricePerSecond ?? listed,
    });
    const life = {
      record: record.nonce,
      provider: this.#options.gpu.name,
      from: pod.createdAt.getTime(),
      pricePerSecond: pod.pricePerSecond ?? listed,
    };
    if (!registered) {
      this.#events.push(
        await terminatePod(this.#host, pod.id, undefined, {
          reason: "another task created the pod for these settings first",
          log,
          life: { ...life, to: this.#now().getTime() },
        }),
      );
      return undefined;
    }
    try {
      return await this.#attach(registered, run, token, holder, 1, true, log);
    } catch (error) {
      // The tasks that joined the pod and find it gone read why there (choice 12).
      await this.#registry.end(
        record.nonce,
        error instanceof PodStartFailure
          ? `${START_FAILED}${error.message}`
          : `it did not serve ${this.#settings.model}`,
      );
      this.#events.push(
        await terminatePod(this.#host, pod.id, undefined, {
          reason: `it did not serve ${this.#settings.model}; it cost about ${usd(podCost(pod.createdAt, this.#now(), listed))}`,
          log,
          life: { ...life, to: this.#now().getTime() },
          warning: true,
        }),
      );
      throw error;
    }
  }

  /**
   * Starts the run on a pod of the registry, once it serves the model. A run that waited for the
   * pod's start shares it: its cost starts with the pod; one that joins a pod already serving
   * starts then. A pod whose image is not known to serve one run at a time must serve several.
   */
  async #attach(
    record: RegisteredPod,
    run: RunRequest,
    token: string,
    holder: string,
    seat: number,
    own: boolean,
    log: Log,
  ): Promise<PodHandle> {
    const { model, image } = this.#settings;
    const podId = record.pod;
    if (!podId) throw new Error("The pod registry holds no pod ID for these settings.");
    // Read once the pod runs: some providers give its URL only after creating it.
    const target: GatewayTarget = { url: "", nonce: record.nonce };
    const created = record.createdAt?.getTime() ?? this.#now().getTime();
    let checks = 0;
    let startedBefore = false;
    const running = await waitUntilReady(
      this.#host,
      podId,
      async () => {
        target.url ||= await this.#host.url(podId, GATEWAY_PORT);
        const response = await (this.#options.fetch ?? fetch)(`${target.url}/health`);
        const health = (response.ok ? await response.json() : {}) as {
          ready?: boolean;
          failed?: boolean;
        };
        if (health.failed) {
          // Only the admin route says why: `/health` takes no token.
          const status = (await this.#admin(target, "GET", "/admin/status").catch(
            () => ({}),
          )) as GatewayStatus;
          throw new PodStartFailure(
            `Pod ${podId} did not serve ${model}: ${status.failure ?? "its gateway reported a failure"}`,
          );
        }
        const ready = health.ready === true;
        if (checks++ === 0) startedBefore = ready;
        return ready;
      },
      {
        timeoutMs: Math.max(0, created + START_MINUTES * 60_000 - this.#now().getTime()),
        wait: this.#options.wait,
      },
    );
    if (running.cudaVersion && (own || onVllm(this.#settings))) {
      log.info(`Pod ${podId} runs on a host with CUDA ${running.cudaVersion}.`);
    }
    const shared = !servesOneRun(image);
    const ollama = this.#settings.ollama ?? {};
    const vllm = onVllm(this.#settings);
    const configured = Object.keys(ollama).length > 0;
    const fits = fitsTheGpu(image);
    if (vllm) {
      const status = (await this.#admin(target, "GET", "/admin/status")) as GatewayStatus;
      if (!sameVariables(status.vllm, this.#settings.vllm ?? {})) {
        throw new Error(
          `Pod ${podId}'s gateway did not apply the vLLM settings (${quotedValues(this.#settings)}): its image cannot.`,
        );
      }
      if (status.fit?.engine !== "vllm") {
        throw new Error(
          `Pod ${podId}'s gateway did not report how vLLM serves ${model}: its image cannot.`,
        );
      }
      await this.#reportVllm(status.fit, podId, own, log);
    } else if (shared || configured || fits) {
      const status = (await this.#admin(target, "GET", "/admin/status")) as GatewayStatus;
      if (shared && (status.version ?? 1) < GATEWAY_VERSION) {
        throw new Error(
          `Pod ${podId}'s gateway serves one run at a time: list its image in SINGLE_RUN_IMAGES (src/inference/ollama.ts) to give each task a pod of its own on it.`,
        );
      }
      if (configured && !sameVariables(status.ollama, ollama)) {
        throw new Error(
          `Pod ${podId}'s gateway did not apply the Ollama settings (${quotedVariables(this.#settings)}): its image cannot. List the image in IMAGES_WITHOUT_OLLAMA_SETTINGS (src/inference/ollama.ts), or use one built since Ollama settings.`,
        );
      }
      if (fits && !status.fit) {
        throw new Error(
          `Pod ${podId}'s gateway did not report how ${model} fits the GPU: its image cannot check it. List the image in IMAGES_WITHOUT_OLLAMA_SETTINGS (src/inference/ollama.ts), or use one built since the fit to the GPU.`,
        );
      }
      if (fits && status.fit && status.fit.engine !== "vllm") {
        await this.#reportFit(status.fit, podId, own, log);
      }
    }
    const handle: PodHandle = {
      mode: "pod",
      podId,
      nonce: record.nonce,
      url: target.url,
      start: startedBefore && !own ? this.#now().getTime() : created,
      created,
      pricePerSecond:
        running.pricePerSecond ??
        record.pricePerSecond ??
        (await this.#host.price(
          this.#settings.gpuType,
          running.host ?? this.#hosts[0],
          this.#settings.priority,
        )),
      limit: run.limit,
      reuse: this.#settings.reuse,
      holder,
      ...(shared ? { shared: { task: String(seat), tokenSha256: sha256(token) } } : {}),
    };
    await this.#admin(handle, "POST", "/admin/run", {
      tokenSha256: sha256(token),
      limit: run.limit,
      start: handle.start,
      pricePerSecond: handle.pricePerSecond,
      ...(handle.shared ? { task: handle.shared.task } : {}),
    });
    const how = own
      ? `Pod ${podId} serves ${model} after ${((this.#now().getTime() - handle.start) / 60_000).toFixed(1)} minutes`
      : !shared
        ? `Reusing pod ${podId}, kept from the task's last run`
        : startedBefore
          ? `Sharing pod ${podId}, already serving ${model}`
          : `Sharing pod ${podId}, from its start`;
    const among = shared ? ", with the organization's tasks on the same settings" : "";
    log.info(`${how}${among}, for up to ${usd(run.limit)}.`);
    return handle;
  }

  #wait(ms: number): Promise<void> {
    return (this.#options.wait ?? ((delay) => new Promise((done) => setTimeout(done, delay))))(ms);
  }

  /** Creates the pod of a creation lease, named by its nonce, with its settings in its environment. */
  async #launch(record: RegisteredPod, log: Log): Promise<{ pod: Pod; listed: number }> {
    const { model, gpuType, image, engine, priority } = this.#settings;
    if (!image) throw new Error("No pod image is pinned; see docs/installation/runpod.md#pods.");
    const hosts = this.#hosts;
    const prices = await this.#prices(gpuType, hosts, priority);
    const vllm = onVllm(this.#settings) ? await this.#prepareVllm(log) : undefined;
    const fits = !vllm && fitsTheGpu(image);
    const memory = fits ? await this.#host.memory?.(gpuType).catch(() => undefined) : undefined;
    const cached = vllm ? vllm.cached : fits ? await this.#cachedFit(log) : undefined;
    const owner = this.#options.repository.owner.toLowerCase();
    const now = this.#now();
    const pod = await this.#host.create({
      name: `codeman-${owner}-${record.settings}`.slice(0, 100),
      image,
      env: {
        ...(Object.keys(this.#settings.ollama ?? {}).length > 0
          ? { CODEMAN_OLLAMA: JSON.stringify(this.#settings.ollama) }
          : {}),
        ...(vllm ? { CODEMAN_VLLM: JSON.stringify(this.#settings.vllm) } : {}),
        ...(memory ? { CODEMAN_GPU_MEMORY_GB: String(memory) } : {}),
        ...(cached ? { CODEMAN_FIT: JSON.stringify(cached) } : {}),
        CODEMAN_ORGANIZATION: owner,
        CODEMAN_POOL: this.#pool.id,
        CODEMAN_ACCOUNT: this.#account,
        CODEMAN_POD_SETTINGS: record.settings,
        CODEMAN_NONCE: record.nonce,
        CODEMAN_MODEL: model,
        CODEMAN_ENGINE: engine.name,
        CODEMAN_ADMIN_SHA256: sha256(adminToken(this.#options.accountKey, record.nonce)),
        CODEMAN_START_BY: new Date(now.getTime() + START_MINUTES * 60_000).toISOString(),
        CODEMAN_KEPT_IDLE_MINUTES: String(KEPT_IDLE_MINUTES),
        CODEMAN_RUN_IDLE_MINUTES: String(RUN_IDLE_MINUTES),
      },
      port: GATEWAY_PORT,
      gpuType,
      diskGb: vllm?.diskGb ?? DISK_GB,
      ...(vllm ? { minCudaVersion: VLLM_MIN_CUDA, sharedMemoryGb: VLLM_SHARED_MEMORY_GB } : {}),
      ...(this.#settings.hosts ? { hosts } : {}),
      ...(priority ? { priority } : {}),
    });
    this.#events.push({ pod: pod.id, event: "created" });
    // The price on the kind of host the provider placed it on; the first offered when it says none.
    const host = pod.host && prices.has(pod.host) ? pod.host : [...prices.keys()][0];
    const listed = (host && prices.get(host)) || (await this.#host.price(gpuType, host, priority));
    const on = hosts.length > 1 || hosts[0] !== "secure" ? ` on ${host ?? hosts[0]} hosts` : "";
    log.info(
      `Created pod ${pod.id} with ${gpuType}${on}, at ${usd(listed * 3600)} per hour; waiting for ${model}.`,
    );
    return { pod, listed };
  }

  /** The kinds of host the pod may run on, by preference. */
  get #hosts(): readonly HostKind[] {
    return this.#settings.hosts ?? DEFAULT_HOSTS;
  }

  /**
   * The GPU type's price on each kind of host that offers it, in the settings' order. Throws the
   * first kind's reason when none does, before any pod is created.
   */
  async #prices(
    gpuType: string,
    hosts: readonly HostKind[],
    priority: string | undefined,
  ): Promise<Map<HostKind, number>> {
    const prices = new Map<HostKind, number>();
    let first: unknown;
    for (const host of hosts) {
      try {
        prices.set(host, await this.#host.price(gpuType, host, priority));
      } catch (error) {
        first ??= error;
      }
    }
    if (prices.size === 0) throw first;
    return prices;
  }

  /**
   * Before creating a vLLM pod, at no cost: a host of the GPU type must offer vLLM's CUDA now
   * (decision 2 of the plan for vLLM on pods), and the model, and its draft model, must be public
   * on Hugging Face with safetensors weights, whose size sets the pod's disk (decision 10). Gives
   * the disk and the cached context.
   */
  async #prepareVllm(
    log: Log,
  ): Promise<{ diskGb: number; cached: { contextLength: number } | undefined }> {
    const { gpuType, model } = this.#settings;
    // Any kind of host the pod may run on will do: the provider places it on one with room.
    if (this.#host.cudaVersions) {
      const offered = (
        await Promise.all(
          this.#hosts.map((host) => this.#host.cudaVersions?.(gpuType, VLLM_MIN_CUDA, host) ?? []),
        )
      ).flat();
      if (!offered.some(({ available }) => available)) {
        const versions = [...new Set(offered.map(({ version }) => version))];
        const on = this.#hosts.length > 1 ? ` on ${this.#hosts.join(" or ")} hosts` : "";
        throw new Error(
          versions.length === 0
            ? `Runpod offers no host${on} with ${gpuType} and CUDA ${VLLM_MIN_CUDA} or newer, which vLLM's image needs, so no pod was created: use another GPU type, or \`engine: ollama\`.`
            : `No host${on} with ${gpuType} and CUDA ${VLLM_MIN_CUDA} or newer has room now (Runpod offers ${versions.join(", ")}), which vLLM's image needs, so no pod was created: try again later, or use another GPU type.`,
        );
      }
    }
    const hub = this.#options.hub ?? new HuggingFace(this.#options.fetch);
    const draft = this.#settings.vllm?.["speculative-model"];
    const models = await Promise.all([model, ...(draft ? [draft] : [])].map((id) => hub.model(id)));
    const weights = models.reduce((total, { weightsBytes }) => total + weightsBytes, 0);
    const diskGb = vllmDiskGb(weights);
    log.info(
      `Hugging Face serves ${models.map(({ id }) => id).join(" and ")}: ${(weights / 1e9).toFixed(1)} GB of weights, so the pod gets ${diskGb} GB of disk.`,
    );
    return { diskGb, cached: await this.#cachedContext(log) };
  }

  /** The context that served a vLLM pod's settings before, from the cache of fits. */
  async #cachedContext(log: Log): Promise<{ contextLength: number } | undefined> {
    if (this.#settings.vllm?.["max-model-len"]) return undefined;
    const path = LAYOUT.context(fitKey(this.#settings));
    try {
      const contextLength = (await this.#options.store.get(path))?.fields.contextLength;
      if (!Number.isSafeInteger(contextLength)) return undefined;
      log.info(`The cache of fits gives these settings a context of ${contextLength} tokens.`);
      return { contextLength: contextLength as number };
    } catch (error) {
      log.warning(
        `Could not read the cache of fits (${error instanceof Error ? error.message : error}); the pod fits the context itself.`,
      );
      return undefined;
    }
  }

  /**
   * Logs how vLLM serves the pod's model, and records in the cache of fits what the pod this
   * task created found from vLLM's measures.
   */
  async #reportVllm(fit: VllmFitReport, podId: string, own: boolean, log: Log): Promise<void> {
    const { model, image, gpuType } = this.#settings;
    const how =
      fit.source === "settings"
        ? "from the settings"
        : fit.source === "cache"
          ? "from the cache of fits"
          : `found in ${fit.loads} start(s)`;
    const theirs = fit.modelContextLength ? ` (the model's own is ${fit.modelContextLength})` : "";
    log.info(
      `Pod ${podId} serves ${model} with vLLM, ${fit.parallel} parallel request(s) and a context of ${fit.contextLength} tokens${theirs}, wholly on the GPU: its K/V cache holds ${fit.concurrency.toFixed(2)} requests of it (${Math.round(fit.cacheTokens)} tokens); ${how}. Its tool calls work with the parser ${fit.toolCallParser}.`,
    );
    if (!own || fit.source !== "search") return;
    const values = Object.fromEntries(
      Object.entries(this.#settings.vllm ?? {}).filter(([key]) => key !== "max-model-len"),
    );
    try {
      await this.#options.store.write([
        {
          op: "set",
          path: LAYOUT.context(fitKey(this.#settings)),
          fields: {
            engine: "vllm",
            image,
            model,
            gpuType,
            vllm: values,
            contextLength: fit.contextLength,
            ...(fit.modelContextLength ? { modelContextLength: fit.modelContextLength } : {}),
            parallel: fit.parallel,
            concurrency: fit.concurrency,
            cacheTokens: fit.cacheTokens,
            loads: fit.loads,
            pod: podId,
            recordedAt: this.#now(),
          },
        },
      ]);
    } catch (error) {
      log.warning(
        `Could not record the fit in the cache of fits (${error instanceof Error ? error.message : error}); the next pod fits it again.`,
      );
    }
  }

  /**
   * The context that fitted these settings before, from the cache of fits, with its model's
   * digest; none with a context length in the settings, or when the cache cannot be read.
   */
  async #cachedFit(log: Log): Promise<{ contextLength: number; digest: string } | undefined> {
    if (this.#settings.ollama?.OLLAMA_CONTEXT_LENGTH) return undefined;
    const path = LAYOUT.context(fitKey(this.#settings));
    try {
      const fields = (await this.#options.store.get(path))?.fields;
      const { contextLength, digest } = fields ?? {};
      if (!Number.isSafeInteger(contextLength) || typeof digest !== "string") return undefined;
      log.info(`The cache of fits gives these settings a context of ${contextLength} tokens.`);
      return { contextLength: contextLength as number, digest };
    } catch (error) {
      log.warning(
        `Could not read the cache of fits (${error instanceof Error ? error.message : error}); the pod searches for the context that fits.`,
      );
      return undefined;
    }
  }

  /**
   * Logs how the pod's model fits its GPU, warns when Ollama serves fewer requests at once than
   * asked, and records in the cache of fits what the pod that this task created found by
   * searching.
   */
  async #reportFit(fit: FitReport, podId: string, own: boolean, log: Log): Promise<void> {
    const { model } = this.#settings;
    const how =
      fit.source === "settings"
        ? "from the settings"
        : fit.source === "cache"
          ? "from the cache of fits"
          : `found in ${fit.loads} load(s)`;
    const theirs = fit.modelContextLength ? ` (the model's own is ${fit.modelContextLength})` : "";
    log.info(
      `Pod ${podId} serves ${model} with ${fit.parallel} parallel request(s) and a context of ${fit.contextLength} tokens${theirs}, wholly on the GPU; ${how}.`,
    );
    if (fit.parallel < fit.requestedParallel) {
      log.warning(
        `Ollama ${OLLAMA_VERSION} serves ${model}'s family (${fit.family ?? "unknown"}) one request at a time, whatever num-parallel says: the runs that share pod ${podId} wait for each other's requests.`,
      );
    }
    if (!own || fit.source !== "search" || !fit.digest) return;
    const variables = Object.fromEntries(
      Object.entries(this.#settings.ollama ?? {}).filter(
        ([name]) => name !== "OLLAMA_CONTEXT_LENGTH",
      ),
    );
    const { image, gpuType } = this.#settings;
    try {
      await this.#options.store.write([
        {
          op: "set",
          path: LAYOUT.context(fitKey(this.#settings)),
          fields: {
            image,
            model,
            digest: fit.digest,
            gpuType,
            ollama: variables,
            contextLength: fit.contextLength,
            ...(fit.modelContextLength ? { modelContextLength: fit.modelContextLength } : {}),
            parallel: fit.parallel,
            loads: fit.loads,
            pod: podId,
            recordedAt: this.#now(),
          },
        },
      ]);
    } catch (error) {
      log.warning(
        `Could not record the fit in the cache of fits (${error instanceof Error ? error.message : error}); the next pod searches again.`,
      );
    }
  }

  #admin(target: GatewayTarget, method: string, path: string, body?: unknown): Promise<unknown> {
    const { fetch: fetchFn = fetch, accountKey } = this.#options;
    return callGateway(fetchFn, accountKey, target, method, path, body);
  }
}

/** The failed start a pod ended with, for the tasks that joined it to fail with. */
function startFailure(pod: RegisteredPod | undefined): PodStartFailure | undefined {
  const reason = pod?.status === "ended" ? pod.reason : undefined;
  if (!reason?.startsWith(START_FAILED)) return undefined;
  return new PodStartFailure(reason.slice(START_FAILED.length));
}

/** The vLLM settings of pod settings, for messages: `` `max-num-seqs=4` ``. */
function quotedValues(settings: Pick<PodSettings, "vllm">): string {
  return vllmValues(settings)
    .map((value) => `\`${value}\``)
    .join(", ");
}

/** Whether a gateway reported exactly the Ollama variables requested. */
function sameVariables(
  reported: Record<string, unknown> | undefined,
  requested: Readonly<Record<string, string>>,
): boolean {
  if (typeof reported !== "object" || reported === null) return false;
  const names = Object.keys(requested);
  return (
    Object.keys(reported).length === names.length &&
    names.every((name) => reported[name] === requested[name])
  );
}

/**
 * What the sweep changes in a live pod of the registry: ends a creation lease that expired, a
 * pod whose own pod no longer runs, and a pod no unexpired lease holds; and drops the task's keep
 * lease on a pod of other settings, which its runs no longer use.
 */
export function sweepChange(
  pod: RegisteredPod,
  context: {
    now: Date;
    holder: string;
    settings: string;
    /** What the provider says of the registry's pod; undefined when not known. */
    status: PodStatus | "missing" | undefined;
  },
): Change | undefined {
  const { now, status } = context;
  if (pod.status === "creating") {
    return (pod.creatingUntil ?? now) > now ? undefined : { end: "its creation lease expired" };
  }
  if (status === "missing" || status === "terminated") return { end: "it no longer exists" };
  if (status === "stopped" || status === "failed") return { end: `it ${status}` };
  const leases =
    pod.settings === context.settings
      ? pod.leases
      : pod.leases.filter((one) => one.holder !== context.holder || one.kind !== "keep");
  const dropped = leases.length < pod.leases.length;
  if (heldBy(leases, now).length === 0) {
    return {
      leases,
      end: dropped ? "the task that kept it runs on other settings now" : "its leases all expired",
    };
  }
  return dropped ? { leases } : undefined;
}

/**
 * Terminates a pod, and says what the ledger records of it: the event, with its reason, and its
 * life, from the registry's record or as given, when known.
 */
async function terminatePod(
  host: Pick<PodHost, "terminate">,
  id: string,
  record: RegisteredPod | undefined,
  options: {
    reason: string;
    log: Log;
    life?: PodLife | undefined;
    provider?: string;
    now?: Date;
    warning?: boolean;
  },
): Promise<PodEvent> {
  await host.terminate(id);
  const message = `Terminated pod ${id}: ${options.reason}.`;
  if (options.warning) options.log.warning(message);
  else options.log.info(message);
  const life =
    options.life ??
    (record?.createdAt && record.pricePerSecond && options.provider && options.now
      ? {
          record: record.nonce,
          provider: options.provider,
          from: record.createdAt.getTime(),
          to: options.now.getTime(),
          pricePerSecond: record.pricePerSecond,
        }
      : undefined);
  return { pod: id, event: "terminated", reason: options.reason, ...(life ? { life } : {}) };
}

/** A pod's life as a run's handle knows it, ending at `now`. */
function lifeOf(handle: PodHandle, provider: string, now: Date): PodLife {
  return {
    record: handle.nonce,
    provider,
    from: handle.created ?? handle.start,
    to: now.getTime(),
    pricePerSecond: handle.pricePerSecond,
  };
}

/**
 * A shared pod's run without the gateway's figure: the pod's time since the run started, capped
 * at the run's limit, since the gateway never lets a run's share pass it. Warns that it is an
 * estimate.
 */
function estimatedShare(handle: PodHandle, now: Date, log: Log): number {
  const elapsed = podCost(new Date(handle.start), now, handle.pricePerSecond);
  const capped = handle.limit !== undefined && handle.limit < elapsed;
  const cost = capped ? (handle.limit as number) : elapsed;
  log.warning(
    `The run's cost is an estimate, since its pod's gateway did not report it: the pod's time since the run started, ${usd(elapsed)}${capped ? `, capped at the run's limit, ${usd(cost)}` : ""}.`,
  );
  return cost;
}

/** The tasks that still use or keep a pod, for the logs. */
function tasksOn(holders: readonly string[]): string {
  return `the tasks that still use or keep it (${holders.join(", ")})`;
}

/** A gateway's usage, in a run's terms. */
function tokens(usage: GatewayUsage | undefined): Omit<RunUsage, "cost"> {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    requests: usage?.requests,
    maxInputTokens: usage?.maxInputTokens,
    tokensPerSecond: usage?.tokensPerSecond,
  };
}

/**
 * Releases the task's keep lease on the pod that `close` kept, once the task does not go on to
 * another run now, and terminates the pod when no other lease holds it. A shared pod first
 * releases the task on its gateway, so its idle time no longer goes to the task.
 */
export async function releasePod(
  host: Pick<PodHost, "terminate">,
  registry: PodRegistry,
  text: string,
  log: Log,
  options: {
    provider: string;
    now?: () => Date;
    gateway?: { accountKey: string; fetch?: typeof fetch };
  },
): Promise<PodEvent[]> {
  const handle = parseHandle(text);
  if (handle.mode !== "pod") return [];
  const { gateway } = options;
  if (handle.shared && gateway) {
    await callGateway(
      gateway.fetch ?? fetch,
      gateway.accountKey,
      handle,
      "POST",
      "/admin/release",
      {
        task: handle.shared.task,
      },
    ).catch(() => undefined);
  }
  const left = await registry.leave(handle.nonce, handle.holder, { onlyKeep: true });
  if (!left.ended) {
    log.info(
      left.holders.length > 0
        ? `Released pod ${handle.podId} for this task; it stays for ${tasksOn(left.holders)}.`
        : `Pod ${handle.podId} had already left the pod registry.`,
    );
    return [];
  }
  const now = options.now?.() ?? new Date();
  return [
    await terminatePod(host, handle.podId, undefined, {
      reason: "the task does not go on to another run now, and no other task uses or keeps it",
      log,
      life: lifeOf(handle, options.provider, now),
    }),
  ];
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
  /** The endpoint's job queue. */
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
 * endpoints by the hour. See docs/inference/serverless.md.
 */
export class ServerlessInference implements InferenceProvider {
  readonly name: string;
  readonly #settings: ServerlessSettings;
  readonly #host: ServerlessHost;
  readonly #usage: string;

  /** `usage` is what the agent job's gateway reported, as JSON; empty when it reported nothing. */
  constructor(settings: ServerlessSettings, gpu: GpuProvider, options: { usage?: string } = {}) {
    if (!gpu.serverless) throw new Error(`${gpu.name} has no Serverless endpoints.`);
    this.name = `${gpu.name} Serverless`;
    this.#settings = settings;
    this.#host = gpu.serverless;
    this.#usage = options.usage ?? "";
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
      url: this.#host.queueUrl(id),
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
      ...(usage.busy
        ? {
            busy: {
              endpoint: handle.endpoint,
              pricePerSecond: handle.pricePerSecond,
              spans: usage.busy,
            },
          }
        : {}),
    };
  }
}

/**
 * Characters of the agent job's usage report at most: GitHub keeps 1 MB of a job's outputs,
 * counted in UTF-16, and 50 MB of a workflow run's, which ten parallel tasks stay far below.
 */
export const MAX_USAGE_CHARS = 200_000;

/**
 * The gateway's usage as the agent job outputs it. A report too large for GitHub's outputs leaves
 * out the run's billed times: the run then counts its own estimate, and takes no part in the
 * split with the endpoint's other runs, whose shared time with it counts whole.
 */
export function usageReport(usage: GatewayUsage, warn: (message: string) => void): string {
  const text = JSON.stringify(usage);
  if (text.length <= MAX_USAGE_CHARS) return text;
  const { busy, ...rest } = usage;
  warn(
    `The run's ${busy?.length ?? 0} billed time span(s) do not fit in the job's output; the run counts its own estimate, unsplit.`,
  );
  return JSON.stringify(rest);
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
  // Billed times that are not in order, or not numbers, are left out: the run is not split.
  const { busy, ...rest } = usage as GatewayUsage;
  return spansInOrder(busy) ? { ...rest, busy } : rest;
}

/** Whether `value` holds spans in milliseconds, each after the one before it. */
function spansInOrder(value: unknown): value is Span[] {
  if (!Array.isArray(value)) return false;
  let last = Number.NEGATIVE_INFINITY;
  for (const span of value as unknown[]) {
    if (!Array.isArray(span) || span.length !== 2) return false;
    const [from, to] = span as unknown[];
    if (typeof from !== "number" || typeof to !== "number") return false;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < last || to < from) return false;
    last = to;
  }
  return true;
}
