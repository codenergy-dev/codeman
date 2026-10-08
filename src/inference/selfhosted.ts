import { createHmac, randomBytes } from "node:crypto";
import { usd } from "../budget.ts";
import { type EndedRun, GATEWAY_VERSION, sha256 } from "../gateway/gateway.ts";
import { GATEWAY_PORT } from "../gateway/pod.ts";
import type { GatewayUsage, Span } from "../gateway/usage.ts";
import type { RepositoryRef } from "../platform/types.ts";
import type { Log } from "../runtime/runtime.ts";
import { repositoryName } from "../store/layout.ts";
import type { Store } from "../store/store.ts";
import type { InferenceEngine } from "./engine.ts";
import {
  endpointProblems,
  type GpuProvider,
  type Pod,
  type PodHost,
  type PodStatus,
  podCost,
  type ServerlessHost,
  waitUntilReady,
} from "./gpu.ts";
import { SINGLE_RUN_IMAGES } from "./ollama.ts";
import {
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
} from "./registry.ts";

/** How long a new pod has to pull its image and model and serve it. */
export const START_MINUTES = 25;
/** How long a kept pod waits for a task's next run, and a task's keep lease lasts. */
export const KEPT_IDLE_MINUTES = 15;
/** A run whose agent sends no request for this long has lost it. */
export const RUN_IDLE_MINUTES = 30;
/** How often a task waiting for another to create the pod of its settings looks again. */
export const CLAIM_POLL_MS = 10_000;
/** Claims a task makes before it gives up: its waits for a creation lease, and pods it could not join. */
const CLAIMS = Math.ceil(CREATE_LEASE_MS / CLAIM_POLL_MS) + 10;
/** Container disk of a pod, in GB: the model and Ollama's image. */
const DISK_GB = 80;
/** Billing is read this far back; older pods have left the spend table's refreshed rows. */
const BILLING_DAYS = 30;

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
  reuse: "task" | "run";
  /** The task's lease in the pod registry: `owner/name#7`. */
  holder: string;
  /**
   * On a pod that serves several tasks: the task's seat on the pod, which names its runs on the
   * gateway, and its token's hash, which names this run. The hash of 32 random bytes tells
   * nothing of the token.
   */
  shared?: { task: string; tokenSha256: string } | undefined;
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
 * The hash of the settings a pod serves, which the organization's tasks with the same settings
 * share it by. On an image that serves one run at a time, the task is one of them: it gets a pod
 * of its own.
 */
export function podSettingsKey(
  settings: Pick<PodSettings, "model" | "gpuType" | "image" | "reuse">,
  holder: string,
): string {
  const { model, gpuType, image, reuse } = settings;
  const parts = [model, gpuType, image, reuse, ...(servesOneRun(image) ? [holder] : [])];
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
 * The token that manages a pod's gateway. It is derived from the account key, so only the jobs
 * that hold that key (open-key, close-key, release-pod) can manage pods, and the pod keeps only
 * its hash.
 */
export function adminToken(accountKey: string, nonce: string): string {
  return createHmac("sha256", accountKey)
    .update(`codeman-gateway-admin:${nonce}`)
    .digest("base64url");
}

/** What a pod's gateway says of itself, from `/admin/status`; older gateways lack the runs. */
interface GatewayStatus {
  version?: number;
  ready?: boolean;
  contextLength?: number;
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
  now?: () => Date;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Self-hosted inference on pods: each run gets a token for a gateway in a pod that serves the
 * task's model. The organization's tasks with the same pod settings share one pod, which they
 * find, create, keep and leave through the pod registry, each with its own run and share of the
 * pod. See docs/architecture.md#self-hosted-inference.
 */
export class PodInference implements InferenceProvider {
  readonly name: string;
  readonly #settings: PodSettings;
  readonly #options: SelfHostedOptions;
  readonly #host: PodHost;
  readonly #registry: PodRegistry;
  /** What this provider did with pods since `open` or `close` last reported it. */
  #events: PodEvent[] = [];

  constructor(settings: PodSettings, options: SelfHostedOptions) {
    if (!options.gpu.pods) throw new Error(`${options.gpu.name} has no pods.`);
    this.name = `${options.gpu.name} pods`;
    this.#settings = settings;
    this.#options = options;
    this.#host = options.gpu.pods;
    this.#registry = new PodRegistry(options.store, options.repository.owner, () => this.#now());
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

  async open(run: RunRequest, log: Log): Promise<OpenedRun> {
    const token = randomBytes(32).toString("base64url");
    const holder = leaseHolder(this.#options.repository, run.task);
    const settings = podSettingsKey(this.#settings, holder);
    let handle: PodHandle;
    try {
      await this.#sweep(holder, settings, log);
      handle = await this.#claim(run, holder, settings, token, log);
    } catch (error) {
      throw new OpenFailure(error, this.#takeEvents());
    }
    // The context length is informational: a failure to read it does not undo the run.
    const status = (await this.#admin(handle, "GET", "/admin/status").catch(
      () => ({}),
    )) as GatewayStatus;
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
   * Ends the run on the pod and reads what it used, then keeps the pod for the next runs on its
   * settings (a keep lease) or leaves it; a pod that no run uses and no task keeps is terminated.
   * A run alone on its pod costs the pod's time since it started; a run on a shared pod, its
   * share, and the task counts what the gateway gave it of the pod: Runpod bills the pod whole.
   */
  async close(text: string, log: Log): Promise<RunUsage> {
    const handle = parseHandle(text);
    if (handle.mode !== "pod") throw new Error("The handle is not a pod run's.");
    const { shared } = handle;
    let ended: EndedRun | undefined;
    try {
      ended =
        ((await this.#admin(
          handle,
          "POST",
          "/admin/end",
          shared ? { tokenSha256: shared.tokenSha256, keep: handle.reuse === "task" } : undefined,
        )) as EndedRun | null) ?? undefined;
    } catch (error) {
      log.warning(
        `Could not read the run's usage from its pod: ${error instanceof Error ? error.message : error}`,
      );
    }
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
        // Without the gateway's figure, the run counts the pod's whole time since it started.
        cost: ended?.cost ?? podCost(new Date(handle.start), now, handle.pricePerSecond),
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

  /** What Runpod billed for these pods; undefined when it could not be read. */
  async #billing(
    pods: readonly string[],
    now: Date,
    log: Log,
  ): Promise<Record<string, number> | undefined> {
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
   * Terminates the organization's pods that nothing holds (step 3 of the pod registry plan), and
   * drops this task's keep leases on pods of other settings. Pods are listed before the registry
   * is read, and a task writes a pod's document before it creates the pod, so a pod being created
   * is always held. A pod without the organization's environment is never touched.
   */
  async #sweep(holder: string, settings: string, log: Log): Promise<void> {
    const owner = this.#options.repository.owner;
    const listed = (await this.#host.list({})).filter((pod) => ofOrganization(pod, owner));
    const statuses = new Map<string, PodStatus | "missing">();
    for (const pod of listed) statuses.set(pod.id, pod.status);
    const held = new Map<string, RegisteredPod>();
    const terminated = new Set<string>();
    for (const record of await this.#registry.live()) {
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
    const description: PodDescription = {
      settings,
      model,
      gpuType,
      image,
      reuse,
      provider: this.#options.gpu.name,
    };
    let waiting = false;
    for (let claims = 0; claims < CLAIMS; claims++) {
      const claim = await this.#registry.claim(description, holder, run.runId);
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
      await this.#registry.end(record.nonce, `it did not serve ${this.#settings.model}`);
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
    const target: GatewayTarget = { url: this.#host.url(podId, GATEWAY_PORT), nonce: record.nonce };
    const created = record.createdAt?.getTime() ?? this.#now().getTime();
    let checks = 0;
    let startedBefore = false;
    const running = await waitUntilReady(
      this.#host,
      podId,
      async () => {
        const response = await (this.#options.fetch ?? fetch)(`${target.url}/health`);
        const ready =
          response.ok && ((await response.json()) as { ready?: boolean }).ready === true;
        if (checks++ === 0) startedBefore = ready;
        return ready;
      },
      {
        timeoutMs: Math.max(0, created + START_MINUTES * 60_000 - this.#now().getTime()),
        wait: this.#options.wait,
      },
    );
    const shared = !servesOneRun(image);
    if (shared) {
      const status = (await this.#admin(target, "GET", "/admin/status")) as GatewayStatus;
      if ((status.version ?? 1) < GATEWAY_VERSION) {
        throw new Error(
          `Pod ${podId}'s gateway serves one run at a time: list its image in SINGLE_RUN_IMAGES (src/inference/ollama.ts) to give each task a pod of its own on it.`,
        );
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
        (await this.#host.price(this.#settings.gpuType)),
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
    const { model, gpuType, image, engine } = this.#settings;
    if (!image) throw new Error("No pod image is pinned; see docs/installation.md.");
    const listed = await this.#host.price(gpuType);
    const owner = this.#options.repository.owner.toLowerCase();
    const now = this.#now();
    const pod = await this.#host.create({
      name: `codeman-${owner}-${record.settings}`.slice(0, 100),
      image,
      env: {
        CODEMAN_ORGANIZATION: owner,
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
      diskGb: DISK_GB,
    });
    this.#events.push({ pod: pod.id, event: "created" });
    log.info(
      `Created pod ${pod.id} with ${gpuType}, at ${usd(listed * 3600)} per hour; waiting for ${model}.`,
    );
    return { pod, listed };
  }

  #admin(target: GatewayTarget, method: string, path: string, body?: unknown): Promise<unknown> {
    const { fetch: fetchFn = fetch, accountKey } = this.#options;
    return callGateway(fetchFn, accountKey, target, method, path, body);
  }
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
 * endpoints by the hour. See docs/architecture.md#self-hosted-inference.
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
