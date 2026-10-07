import { createHmac, randomBytes } from "node:crypto";
import { usd } from "../budget.ts";
import { type EndedRun, GATEWAY_VERSION, sha256 } from "../gateway/gateway.ts";
import { GATEWAY_PORT } from "../gateway/pod.ts";
import type { GatewayUsage } from "../gateway/usage.ts";
import type { RepositoryRef } from "../platform/types.ts";
import type { Log } from "../runtime/runtime.ts";
import type { InferenceEngine } from "./engine.ts";
import {
  accountMonthSpent,
  endpointProblems,
  type GpuProvider,
  type Pod,
  type PodHost,
  podCost,
  type ServerlessHost,
  waitUntilReady,
} from "./gpu.ts";
import { SINGLE_RUN_IMAGES } from "./ollama.ts";
import type { InferenceProvider, OpenedRun, PodEvent, RunRequest, RunUsage } from "./provider.ts";

/** How long a new pod has to pull its image and model and serve it. */
export const START_MINUTES = 25;
/** How long a kept pod waits for its task's next run (decision 12 of the plan). */
export const KEPT_IDLE_MINUTES = 15;
/** A run whose agent sends no request for this long has lost it. */
export const RUN_IDLE_MINUTES = 30;
/**
 * How long a task of a run that shares a pod waits, per task before it, for another to create
 * the pod before it creates one: legs start at once, and the first usually creates it.
 */
export const SHARE_STAGGER_MS = 20_000;
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
  /** The run's other tasks that run an agent at the same time: their jobs manage their pods. */
  others?: readonly string[] | undefined;
}

export interface PodSettings extends SelfHostedSettings {
  gpuType: string;
  /** The pod image, by digest. */
  image: string;
  /** `task`: a pod serves the task's next run too, while the task goes on; `run`: one run. */
  reuse: "task" | "run";
  /**
   * With `parallel-tasks` above 1: the run's tasks with the same pod settings share one pod,
   * and a kept one serves any of them (decision 2 of the parallel tasks plan).
   */
  share?: boolean | undefined;
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
  /** When the pod was created; its whole life counts in the task's spend. */
  created?: number | undefined;
  pricePerSecond: number;
  reuse: "task" | "run";
  /**
   * On a pod that serves several tasks: the run's task and its token's hash, which name the run
   * on the gateway. The hash of 32 random bytes tells nothing of the token.
   */
  shared?: { task: string; tokenSha256: string } | undefined;
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

/**
 * The tasks of a workflow run that share a pod: the run's ID, and a hash of the pod's settings.
 * Pods created for them carry it in `CODEMAN_GROUP`, and a kept pod they reuse in its gateway.
 */
export function podGroup(runId: string, settings: PodSettings): string {
  const { model, gpuType, image, reuse } = settings;
  return `${runId}.${sha256([model, gpuType, image, reuse].join("\n")).slice(0, 16)}`;
}

/** What a pod's gateway says of itself, from `/admin/status`; older gateways lack the runs. */
interface GatewayStatus {
  version?: number;
  ready?: boolean;
  serving?: boolean;
  lastActivity?: number;
  contextLength?: number;
  group?: string;
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
  now?: () => Date;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Self-hosted inference on pods: each run gets a token for a gateway in a pod that serves the
 * task's model, created for the run or kept from an earlier one; with several tasks at once, the
 * run's tasks with the same pod settings share one. See
 * docs/architecture.md#self-hosted-inference.
 */
export class PodInference implements InferenceProvider {
  readonly name: string;
  readonly #settings: PodSettings;
  readonly #options: SelfHostedOptions;
  readonly #host: PodHost;
  /** What this provider did with pods since `open` or `close` last reported it. */
  #events: PodEvent[] = [];

  constructor(settings: PodSettings, options: SelfHostedOptions) {
    if (!options.gpu.pods) throw new Error(`${options.gpu.name} has no pods.`);
    this.name = `${options.gpu.name} pods`;
    this.#settings = settings;
    this.#options = options;
    this.#host = recorded(options.gpu.pods, (event) => this.#events.push(event));
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

  async taskSpent(): Promise<number> {
    return this.#settings.taskSpent;
  }

  async monthSpent(): Promise<number> {
    return accountMonthSpent(this.#options.gpu, this.#now());
  }

  async open(run: RunRequest, log: Log): Promise<OpenedRun> {
    const token = randomBytes(32).toString("base64url");
    let handle: PodHandle;
    if (this.#settings.share && !SINGLE_RUN_IMAGES.has(this.#settings.image)) {
      handle = await this.#openShared(run, token, log);
    } else {
      if (this.#settings.share) {
        log.info("The pod image serves one run at a time: this task gets a pod of its own.");
      }
      const kept = await this.#sweep(run, log);
      handle = kept
        ? await this.#reuse(kept, run, token, log)
        : await this.#create(run, token, log);
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
   * Ends the run on the pod, reads what it used, and keeps the pod for the task's next run or
   * terminates it. The run's cost is the pod's time since the run started, at its price.
   */
  async close(text: string, log: Log): Promise<RunUsage> {
    const handle = parseHandle(text);
    if (handle.mode !== "pod") throw new Error("The handle is not a pod run's.");
    if (handle.shared) return this.#closeShared(handle, handle.shared, log);
    let usage: GatewayUsage | undefined;
    try {
      usage =
        ((await this.#admin(handle, "POST", "/admin/end")) as GatewayUsage | null) ?? undefined;
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
    const now = this.#now();
    const cost = podCost(new Date(handle.start), now, handle.pricePerSecond);
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
      ...tokens(usage),
      cost,
      pod: handle.podId,
      podCosts,
      keptPod: keep ? handle.podId : undefined,
      pods: this.#takeEvents(),
    };
  }

  /**
   * Ends the run on a pod that serves several tasks. The run's cost is its share of the pod's
   * time, and the task's count of the pod is the gateway's (its runs and the kept time it was
   * given): Runpod bills the pod as a whole. A pod that no task keeps and no run uses is
   * terminated; the gateway answers one job at a time, so only the last to leave does it.
   */
  async #closeShared(
    handle: PodHandle,
    shared: NonNullable<PodHandle["shared"]>,
    log: Log,
  ): Promise<RunUsage> {
    let ended: EndedRun | undefined;
    try {
      ended =
        ((await this.#admin(handle, "POST", "/admin/end", {
          tokenSha256: shared.tokenSha256,
          keep: handle.reuse === "task",
        })) as EndedRun | null) ?? undefined;
    } catch (error) {
      log.warning(
        `Could not read the run's usage from its pod: ${error instanceof Error ? error.message : error}`,
      );
    }
    const share = ended?.share;
    const keep = handle.reuse === "task" && ended !== undefined;
    if (keep) {
      log.info(
        `Kept pod ${handle.podId} for the next runs of its tasks, for ${KEPT_IDLE_MINUTES} minutes at most.`,
      );
    } else if (!share || (share.active.length === 0 && share.keepers.length === 0)) {
      await this.#host.terminate(handle.podId);
      log.info(`Terminated pod ${handle.podId}.`);
    } else {
      log.info(`Left pod ${handle.podId} to ${tasksOn(share)}.`);
    }
    const now = this.#now();
    // Without the gateway's figure, the run counts the pod's whole time since it started.
    const cost = ended?.cost ?? podCost(new Date(handle.start), now, handle.pricePerSecond);
    const billed = await this.#billing(this.#settings.pods, now, log);
    const podCosts = { ...billed };
    if (share) podCosts[handle.podId] = Number(share.taskCost.toFixed(6));
    return {
      ...tokens(ended),
      cost,
      pod: handle.podId,
      podCosts,
      podShared: true,
      keptPod: keep ? handle.podId : undefined,
      pods: this.#takeEvents(),
    };
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
   * Terminates this repository's pods that serve nobody: no other run of the repository is
   * active while open-key runs, so a pod that is still starting or serving lost its run, unless
   * it is another task's of this run, or one that this run's tasks share, whose own jobs open
   * and close it at the same time. Other tasks' kept pods stay until their idle limit, and so
   * do kept shared pods, which serve any of their tasks. Returns the task's kept pod, if it fits
   * and the run does not share pods.
   */
  async #sweep(run: RunRequest, log: Log): Promise<{ pod: Pod; nonce: string } | undefined> {
    let kept: { pod: Pod; nonce: string } | undefined;
    const others = new Set(this.#settings.others ?? []);
    const ofRun = (group: string | undefined) => group?.startsWith(`${run.runId}.`) === true;
    for (const pod of await this.#host.list(podOwner(this.#options.repository))) {
      if (others.has(pod.env.CODEMAN_TASK ?? "") || ofRun(pod.env.CODEMAN_GROUP)) continue;
      const nonce = pod.env.CODEMAN_NONCE ?? "";
      const handle = { podId: pod.id, nonce, url: this.#host.url(pod.id, GATEWAY_PORT) };
      const status = (await this.#admin(handle, "GET", "/admin/status").catch(() => undefined)) as
        | GatewayStatus
        | undefined;
      if (ofRun(status?.group)) continue;
      const idle =
        status?.ready === true &&
        status.serving === false &&
        this.#now().getTime() - (status.lastActivity ?? 0) < KEPT_IDLE_MINUTES * 60_000;
      const shared = pod.env.CODEMAN_GROUP !== undefined;
      const fits =
        !this.#settings.share && !shared && pod.env.CODEMAN_TASK === run.task && this.#fits(pod);
      if (idle && fits && !kept) {
        kept = { pod, nonce };
      } else if (!idle || (pod.env.CODEMAN_TASK === run.task && !shared)) {
        const why = !idle ? "it serves no run of this repository" : "the task's settings changed";
        log.info(`Terminating pod ${pod.id} (task #${pod.env.CODEMAN_TASK ?? "?"}): ${why}.`);
        await this.#host.terminate(pod.id);
      }
    }
    return kept;
  }

  /** Whether a pod serves the run's settings. */
  #fits(pod: Pod): boolean {
    return (
      pod.env.CODEMAN_MODEL === this.#settings.model &&
      pod.gpuType === this.#settings.gpuType &&
      pod.image === this.#settings.image
    );
  }

  /**
   * Gives the run a pod that the run's tasks with the same settings share: one another task of
   * the run created or claimed, or else a kept shared pod that fits, or else a new one. Legs
   * start at once, so a task after the first waits a little before it creates one.
   */
  async #openShared(run: RunRequest, token: string, log: Log): Promise<PodHandle> {
    const group = podGroup(run.runId, this.#settings);
    await this.#sweep(run, log);
    const tasks = [run.task, ...(this.#settings.others ?? [])].map(Number).sort((a, b) => a - b);
    const position = tasks.indexOf(Number(run.task));
    const gone = new Set<string>();
    for (let look = 0; ; look++) {
      const found = await this.#findShared(group, gone);
      if (found) {
        try {
          return await this.#attach(found, run, token, group, false, log);
        } catch (error) {
          // Its tasks may have left it before this one's job started, or it failed to start.
          log.warning(
            `Could not share pod ${found.id}: ${error instanceof Error ? error.message : error}`,
          );
          gone.add(found.id);
          continue;
        }
      }
      if (look > 0 || position <= 0) break;
      await this.#wait(position * SHARE_STAGGER_MS);
    }
    const { pod, listed } = await this.#launch(run, log, group);
    // Another task may have created one at the same time: the earliest serves them all.
    const [first] = sortByAge(
      await this.#host.list({ ...podOwner(this.#options.repository), CODEMAN_GROUP: group }),
    ).filter((one) => live(one) && !gone.has(one.id));
    if (first && first.id !== pod.id) {
      await this.#host.terminate(pod.id);
      log.info(`Terminated pod ${pod.id}: another task of this run created pod ${first.id} first.`);
      return this.#attach(first, run, token, group, false, log);
    }
    try {
      return await this.#attach(pod, run, token, group, true, log);
    } catch (error) {
      await this.#host.terminate(pod.id);
      log.warning(
        `Terminated pod ${pod.id}, which did not serve ${this.#settings.model}; it cost about ${usd(podCost(pod.createdAt, this.#now(), listed))}.`,
      );
      throw error;
    }
  }

  /**
   * The pod of the run's group, created or claimed by another of its tasks; else the oldest kept
   * shared pod that fits, whose gateway serves several runs.
   */
  async #findShared(group: string, gone: ReadonlySet<string>): Promise<Pod | undefined> {
    const pods = sortByAge(await this.#host.list(podOwner(this.#options.repository))).filter(
      (pod) =>
        pod.env.CODEMAN_GROUP !== undefined && this.#fits(pod) && live(pod) && !gone.has(pod.id),
    );
    let kept: Pod | undefined;
    for (const pod of pods) {
      if (pod.env.CODEMAN_GROUP === group) return pod;
      const status = await this.#status(this.#target(pod)).catch(() => undefined);
      if (status?.group === group) return pod;
      const idle =
        (status?.version ?? 1) >= GATEWAY_VERSION &&
        status?.ready === true &&
        status.serving === false &&
        this.#now().getTime() - (status.lastActivity ?? 0) < KEPT_IDLE_MINUTES * 60_000;
      if (idle) kept ??= pod;
    }
    return kept;
  }

  /**
   * Starts the run on a shared pod, once it serves the model. A run that waited for the pod's
   * start shares it: its cost starts with the pod. A gateway that serves one run at a time, from
   * an older image, serves this task alone if it created the pod; any other task gets its own.
   */
  async #attach(
    pod: Pod,
    run: RunRequest,
    token: string,
    group: string,
    own: boolean,
    log: Log,
  ): Promise<PodHandle> {
    const target = this.#target(pod);
    let status: GatewayStatus | undefined;
    let checks = 0;
    let startedBefore = false;
    const running = await waitUntilReady(
      this.#host,
      pod.id,
      async () => {
        status = await this.#status(target);
        if (checks++ === 0) startedBefore = status.ready === true;
        // An older gateway tells no version: no need to wait for its model to know.
        return status.ready === true || status.version === undefined;
      },
      {
        timeoutMs: Math.max(
          0,
          pod.createdAt.getTime() + START_MINUTES * 60_000 - this.#now().getTime(),
        ),
        wait: this.#options.wait,
      },
    );
    if ((status?.version ?? 1) < GATEWAY_VERSION) {
      log.info(`Pod ${pod.id}'s gateway serves one run at a time, from an older image.`);
      if (own)
        return this.#serve(pod, await this.#host.price(this.#settings.gpuType), run, token, log);
      log.info("This task gets a pod of its own.");
      return this.#create(run, token, log);
    }
    const handle: PodHandle = {
      mode: "pod",
      podId: pod.id,
      nonce: target.nonce,
      url: target.url,
      start: startedBefore && !own ? this.#now().getTime() : pod.createdAt.getTime(),
      created: pod.createdAt.getTime(),
      pricePerSecond:
        running.pricePerSecond ??
        pod.pricePerSecond ??
        (await this.#host.price(this.#settings.gpuType)),
      reuse: this.#settings.reuse,
      shared: { task: run.task, tokenSha256: sha256(token) },
    };
    await this.#startRun(handle, run, token, group);
    const how = own
      ? `Pod ${pod.id} serves ${this.#settings.model} after ${((this.#now().getTime() - handle.start) / 60_000).toFixed(1)} minutes`
      : startedBefore
        ? `Sharing pod ${pod.id}, already serving ${this.#settings.model}`
        : `Sharing pod ${pod.id}, from its start`;
    log.info(
      `${how}, with the run's other tasks on the same settings, for up to ${usd(run.limit)}.`,
    );
    return handle;
  }

  #target(pod: Pod): GatewayTarget {
    return { url: this.#host.url(pod.id, GATEWAY_PORT), nonce: pod.env.CODEMAN_NONCE ?? "" };
  }

  async #status(target: GatewayTarget): Promise<GatewayStatus> {
    return (await this.#admin(target, "GET", "/admin/status")) as GatewayStatus;
  }

  #wait(ms: number): Promise<void> {
    return (this.#options.wait ?? ((delay) => new Promise((done) => setTimeout(done, delay))))(ms);
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
      created: pod.createdAt.getTime(),
      pricePerSecond,
      reuse: this.#settings.reuse,
    };
    await this.#startRun(handle, run, token);
    log.info(`Reusing pod ${pod.id}, kept from the task's last run, for up to ${usd(run.limit)}.`);
    return handle;
  }

  async #create(run: RunRequest, token: string, log: Log): Promise<PodHandle> {
    const { pod, listed } = await this.#launch(run, log);
    return this.#serve(pod, listed, run, token, log);
  }

  /** Creates a pod for the run, or for its group of tasks that share one. */
  async #launch(run: RunRequest, log: Log, group?: string): Promise<{ pod: Pod; listed: number }> {
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
        ...(group ? { CODEMAN_GROUP: group } : {}),
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
    const shared = group ? ", for the run's tasks on the same settings" : "";
    log.info(
      `Created pod ${pod.id} with ${gpuType}, at ${usd(listed * 3600)} per hour${shared}; waiting for ${model}.`,
    );
    return { pod, listed };
  }

  /** Waits for a new pod to serve the model, and starts the run on it alone. */
  async #serve(
    pod: Pod,
    listed: number,
    run: RunRequest,
    token: string,
    log: Log,
  ): Promise<PodHandle> {
    const { model } = this.#settings;
    const nonce = pod.env.CODEMAN_NONCE ?? "";
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
        created: pod.createdAt.getTime(),
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

  async #startRun(handle: PodHandle, run: RunRequest, token: string, group?: string) {
    await this.#admin(handle, "POST", "/admin/run", {
      tokenSha256: sha256(token),
      limit: run.limit,
      start: handle.start,
      pricePerSecond: handle.pricePerSecond,
      ...(handle.shared ? { task: handle.shared.task, group } : {}),
    });
  }

  #admin(target: GatewayTarget, method: string, path: string, body?: unknown): Promise<unknown> {
    const { fetch: fetchFn = fetch, accountKey } = this.#options;
    return callGateway(fetchFn, accountKey, target, method, path, body);
  }
}

/** The tasks a shared pod still serves or is kept for, for the logs. */
function tasksOn(share: { active: string[]; keepers: string[] }): string {
  const tasks = [...new Set([...share.active, ...share.keepers])].map((task) => `#${task}`);
  return `the tasks that still use or keep it (${tasks.join(", ")})`;
}

/** Whether a pod is starting or running, not on its way out. */
function live(pod: Pod): boolean {
  return pod.status === "starting" || pod.status === "running";
}

/** Pods from the oldest, and by ID when created at once: every task picks the same first. */
function sortByAge(pods: readonly Pod[]): Pod[] {
  return [...pods].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
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
 * Terminates a pod that `close` kept, once the task does not go on to another run. A shared pod
 * first releases the task on its gateway, and is terminated only when no other task uses or
 * keeps it; a gateway that does not answer cannot serve them either.
 */
export async function releasePod(
  host: Pick<PodHost, "terminate">,
  text: string,
  log: Log,
  gateway?: { accountKey: string; fetch?: typeof fetch },
): Promise<PodEvent[]> {
  const handle = parseHandle(text);
  if (handle.mode !== "pod") return [];
  if (handle.shared && gateway) {
    const status = (await callGateway(
      gateway.fetch ?? fetch,
      gateway.accountKey,
      handle,
      "POST",
      "/admin/release",
      { task: handle.shared.task },
    ).catch(() => undefined)) as { active?: string[]; keepers?: string[] } | undefined;
    const share = { active: status?.active ?? [], keepers: status?.keepers ?? [] };
    if (status && share.active.length + share.keepers.length > 0) {
      log.info(`Released pod ${handle.podId} for this task; it stays for ${tasksOn(share)}.`);
      return [];
    }
  }
  await host.terminate(handle.podId);
  log.info(`Terminated pod ${handle.podId}: the task does not go on to another run now.`);
  return [{ pod: handle.podId, event: "terminated" }];
}

/** The pod host, telling `record` of each pod it creates or terminates. */
function recorded(host: PodHost, record: (event: PodEvent) => void): PodHost {
  return {
    price: (gpuType) => host.price(gpuType),
    create: async (spec) => {
      const pod = await host.create(spec);
      record({ pod: pod.id, event: "created" });
      return pod;
    },
    get: (id) => host.get(id),
    list: (env) => host.list(env),
    terminate: async (id) => {
      await host.terminate(id);
      record({ pod: id, event: "terminated" });
    },
    url: (id, port) => host.url(id, port),
    billing: (ids, since) => host.billing(ids, since),
  };
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
    return accountMonthSpent(this.#gpu, this.#now());
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
