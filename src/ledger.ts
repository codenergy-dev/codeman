import { setTimeout as sleep } from "node:timers/promises";
import {
  type BilledHours,
  expired,
  type LedgerRun,
  RESERVATION_MS,
  reconciledMonth,
  reserving,
  runAmount,
  runLimit,
  spentBy,
  usd,
} from "./budget.ts";
import type { PodEvent, PodLife, RunUsage } from "./inference/provider.ts";
import type { Log, Runtime } from "./runtime/runtime.ts";
import { isLedgerRunId, LAYOUT, ledgerMonth, repositoryName } from "./store/layout.ts";
import type { Fields, Store, StoredDocument, StoreReader, Write } from "./store/store.ts";
import { oneLine } from "./text.ts";

/** What can happen to a run, as its events name it. */
export type EventType =
  | "task-picked"
  | "key-opened"
  | "key-refused"
  | "key-failed"
  | "pod-created"
  | "pod-joined"
  | "pod-terminated"
  | "run-stopped"
  | "run-closed";

/** Where the ledger's writes come from: a job of a workflow run. */
export interface LedgerSource {
  runtime: Pick<Runtime, "repository" | "run">;
  /** The step the job runs, such as `open-key`. */
  job: string;
}

/** What `select` knows of a run when it picks its task. */
export interface PickedRun {
  action: string;
  /** What the agent works on: `plan`, `route` or a stage; empty without an agent. */
  stage: string;
  /** Whether the task runs an agent, and so has a run's document. */
  agent: boolean;
  model: string;
  /** Where the model is served: `openrouter`, or the GPU provider. */
  provider: string;
  mode: "openrouter" | "pod" | "serverless";
  profile: string | undefined;
}

/** What `open-key` checks a run against, and what the task's record counted before the ledger. */
export interface Budgets {
  task: number;
  taskBudget: number;
  monthlyBudget: number;
  /** The organization's monthly budget; undefined when its settings set none. */
  organizationBudget?: number | undefined;
  /** The total of the task's record, which the task's first run under the ledger carries. */
  recorded: number;
  /** The hourly billing of each GPU provider that reconciles the organization's month. */
  billed: ReadonlyMap<string, BilledHours>;
}

/** What `reserve` found, and whether it reserved the run's limit or why not. */
export interface Reservation {
  outcome: "reserved" | "task-budget-spent" | "over-budget" | "over-organization-budget";
  /** What the run may spend: what remains of the task's budget, when that is enough. */
  limit: number | undefined;
  /** The task's total before the run. */
  task: number;
  /** The repository's month before the run, open runs' limits included. */
  month: number;
  /** What the repository's other open runs reserve of it, and how many they are. */
  reserved: { amount: number; runs: number };
  /** The organization's month before the run, when it has a budget. */
  organization: number | undefined;
}

/** Figures the providers give of a task's runs, which replace the ledger's when they differ. */
export interface Refreshed {
  /** What each run of the task spent on OpenRouter, by workflow run ID, from its keys. */
  costs?: Readonly<Record<string, number>> | undefined;
  /** What each of the task's pods cost so far, by pod ID. */
  pods?: Readonly<Record<string, number>> | undefined;
}

/** Waits between attempts to reach the store: four attempts in all. */
const RETRY_MS = [1_000, 3_000, 9_000];
/**
 * Attempts of a reservation: every `open-key` of the organization reads the month, so tasks
 * that open at once run their reservations again, one after another.
 */
const RESERVE_ATTEMPTS = 20;

/**
 * Codeman's record of its runs, in the store (step 6 of the backend plan): a document for each
 * run of a task's agent, and its events. Each job adds what it knows to the run's document and
 * says what it did; the ledger keeps it until `flush`, which a job calls after its GitHub
 * writes, so a store that fails fails the job without leaving GitHub half written. Writes are
 * idempotent, so a re-run job writes the same documents again: a run's fields are merged, and an
 * event's ID is its run and what happened. The budgets read it: `reserve` checks a run against
 * them and reserves its limit, in a transaction (docs/architecture.md#budget).
 */
export class Ledger {
  readonly #store: Store;
  readonly #source: LedgerSource;
  readonly #now: () => Date;
  readonly #wait: (ms: number) => Promise<void>;
  #writes: Write[] = [];
  /** The pods the job terminated, with their lives: `flush` records their time no task counted. */
  #lives: { pod: string; life: PodLife }[] = [];

  constructor(
    store: Store,
    source: LedgerSource,
    options: { now?: () => Date; wait?: (ms: number) => Promise<void> } = {},
  ) {
    this.#store = store;
    this.#source = source;
    this.#now = options.now ?? (() => new Date());
    this.#wait = options.wait ?? ((ms) => sleep(ms));
  }

  /**
   * Reads the organization's document, to fail before anything else when the store cannot be
   * reached: the job's identity is refused, the service account lacks its role, or there is no
   * database.
   */
  async check(log: Log): Promise<void> {
    await this.#retry(log, "read Codeman's store", () =>
      this.#store.get(LAYOUT.organization(this.#source.runtime.repository.owner)),
    );
  }

  /** `select` picked the run's task: the run's document, for an agent, and the event. */
  pick(run: string, picked: PickedRun): void {
    const at = this.#now();
    if (picked.agent) {
      this.#update(run, {
        repository: repositoryName(this.#source.runtime.repository),
        task: taskOf(run),
        workflowRun: this.#source.runtime.run.id,
        attempt: this.#source.runtime.run.attempt,
        // The month the run counts in, for the budgets' queries.
        month: ledgerMonth(at),
        status: "picked",
        pickedAt: at,
        stage: picked.stage,
        model: picked.model,
        provider: picked.provider,
        mode: picked.mode,
        profile: picked.profile ?? null,
      });
    }
    this.#event(run, "task-picked", { action: picked.action, stage: picked.stage });
  }

  /** The runs of the task of `run`, in every month. */
  async taskRuns(run: string, log: Log): Promise<LedgerRun[]> {
    const { owner } = this.#source.runtime.repository;
    return this.#retry(log, "read Codeman's ledger", async () =>
      ledgerRuns(await taskQuery(this.#store, owner, this.#repository(), taskOf(run))),
    );
  }

  /**
   * The organization's runs this month, of every repository, and its pods' time that no task
   * counted.
   */
  async monthRuns(log: Log): Promise<LedgerRun[]> {
    const { owner } = this.#source.runtime.repository;
    const month = ledgerMonth(this.#now());
    return this.#retry(log, "read Codeman's ledger", async () => [
      ...ledgerRuns(await monthQuery(this.#store, owner, month)),
      ...untrackedRuns(await untrackedQuery(this.#store, owner, month)),
    ]);
  }

  /**
   * Replaces the costs of a task's `runs` with what the providers say now: OpenRouter's keys,
   * for each run that closed or expired and whose workflow run has no other run of the task (an
   * expired run then counts its cost, not its limit); and each pod's cost, on the task's last
   * run on it, when higher. Writes at once, and returns the runs as they are now.
   */
  async refresh(runs: readonly LedgerRun[], figures: Refreshed, log: Log): Promise<LedgerRun[]> {
    const now = this.#now();
    const writes: Write[] = [];
    const next = runs.map((run) => ({ ...run }));
    const change = (run: LedgerRun, fields: Partial<LedgerRun> & Fields) => {
      Object.assign(run, fields);
      writes.push({
        op: "set",
        path: LAYOUT.run(this.#source.runtime.repository.owner, run.id),
        fields,
        merge: true,
      });
    };
    for (const [workflowRun, figure] of Object.entries(figures.costs ?? {})) {
      const same = next.filter((run) => run.workflowRun === workflowRun);
      const [run] = same;
      const ended =
        run !== undefined &&
        (run.status === "closed" || run.status === "expired" || expired(run, now));
      if (same.length !== 1 || !run || run.provider !== "openrouter" || !ended) continue;
      const cost = Math.max(0, figure - (run.spentBefore ?? 0));
      if (run.cost !== undefined && Math.abs(run.cost - cost) < 0.0001) continue;
      change(run, expired(run, now) ? { cost, status: "expired" } : { cost });
    }
    for (const [pod, figure] of Object.entries(figures.pods ?? {})) {
      const on = next.filter((run) => run.pod === pod && !reserving(run, now));
      const last = on.at(-1);
      if (!last || figure <= Math.max(0, ...on.map((run) => run.podCost ?? 0))) continue;
      change(last, { podCost: figure });
    }
    if (writes.length > 0) {
      await this.#retry(log, "write to Codeman's ledger", () => this.#store.write(writes));
      log.info(`Refreshed ${writes.length} of the task's run(s) in Codeman's ledger.`);
    }
    return next;
  }

  /**
   * Reserves the run's limit (decision 1 of the ledger budgets plan): in one transaction, reads
   * the task's runs and the month's, and when what remains of the task's budget fits in the
   * repository's month and the organization's, writes it as the run's limit, open. Tasks and
   * repositories that open at once each see the others' reservations, or run again once they
   * are written, so together they never pass a budget. Writes nothing when it refuses.
   */
  async reserve(run: string, budgets: Budgets): Promise<Reservation> {
    const { owner } = this.#source.runtime.repository;
    const repository = this.#repository();
    const path = LAYOUT.run(owner, run);
    const now = this.#now();
    return this.#store.transaction(
      async (tx) => {
        const organization = budgets.organizationBudget !== undefined;
        const [task, month, untracked] = await Promise.all([
          taskQuery(tx, owner, repository, budgets.task).then(ledgerRuns),
          monthQuery(tx, owner, ledgerMonth(now), organization ? undefined : repository).then(
            ledgerRuns,
          ),
          // Pods' time no task counted belongs to the organization's month alone (decision 4 of
          // the pod registry plan).
          organization
            ? untrackedQuery(tx, owner, ledgerMonth(now)).then(untrackedRuns)
            : Promise.resolve([]),
        ]);
        const own = task.find((other) => other.id === run);
        // What an earlier attempt of this run spent, when it closed; a reservation replaces the
        // run's own limit.
        const before = own && own.status !== "open" ? runAmount(own) : 0;
        const others = task.filter((other) => other.id !== run);
        const carries = task.some((other) => other.carried !== undefined);
        const carried = carries ? undefined : Math.max(0, budgets.recorded - spentBy(others));
        const spent =
          spentBy(others) +
          task.reduce((sum, other) => sum + (other.carried ?? 0), 0) +
          (carried ?? 0) +
          before;
        const monthRuns = month.filter((other) => other.id !== run);
        const ours = monthRuns.filter((other) => other.repository === repository);
        const open = ours.filter((other) => reserving(other, now));
        const reservation: Reservation = {
          outcome: "reserved",
          limit: runLimit(budgets.taskBudget, spent),
          task: spent,
          month: spentBy(ours) + before,
          reserved: { amount: spentBy(open), runs: open.length },
          organization:
            budgets.organizationBudget === undefined
              ? undefined
              : reconciledMonth([...monthRuns, ...untracked], budgets.billed, now) + before,
        };
        const { limit } = reservation;
        if (limit === undefined) return { ...reservation, outcome: "task-budget-spent" };
        if (reservation.month + limit > budgets.monthlyBudget) {
          return { ...reservation, outcome: "over-budget" };
        }
        if (
          reservation.organization !== undefined &&
          budgets.organizationBudget !== undefined &&
          reservation.organization + limit > budgets.organizationBudget
        ) {
          return { ...reservation, outcome: "over-organization-budget" };
        }
        tx.write({
          op: "set",
          path,
          fields: {
            status: "open",
            reservedAt: now,
            expiresAt: new Date(now.getTime() + RESERVATION_MS),
            limit,
            ...(carried === undefined ? {} : { carried }),
            // An earlier attempt's figures give way to this one's, and count as spent before.
            ...(own?.cost === undefined && own?.spentBefore === undefined
              ? {}
              : { spentBefore: before, cost: null, closedAt: null, podCost: null }),
          },
          merge: true,
        });
        return reservation;
      },
      { attempts: RESERVE_ATTEMPTS },
    );
  }

  /** `open-key` gave the run its access, limited to `limit` USD. */
  open(run: string, limit: number, pods: readonly PodEvent[] | undefined): void {
    this.#update(run, { openedAt: this.#now() });
    this.#event(run, "key-opened", { limit });
    this.#pods(run, pods);
  }

  /**
   * `open-key` could not open the run it reserved: it spent nothing that the budgets can tell,
   * and its reservation ends.
   */
  fail(run: string, reason: string, pods?: readonly PodEvent[] | undefined): void {
    this.#update(run, { status: "failed", failedAt: this.#now(), cost: 0, reason });
    this.#event(run, "key-failed", { reason });
    this.#pods(run, pods);
  }

  /** `open-key` refused the run: `status` is its output, `reason` why. */
  refuse(run: string, status: string, reason: string): void {
    this.#update(run, { status: "refused", refusedAt: this.#now(), refusal: status, reason });
    this.#event(run, "key-refused", { status, reason });
  }

  /**
   * `close-key` ended the run's access and read what it used; `agentJob` is the agent job's
   * result, and a run whose agent job did not succeed also stopped.
   */
  close(run: string, usage: RunUsage, agentJob: string): void {
    // Unknown figures are left out, as in the spend table.
    const figures: Record<string, number> = {};
    for (const [name, value] of Object.entries({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      requests: usage.requests,
      maxInputTokens: usage.maxInputTokens,
      tokensPerSecond: usage.tokensPerSecond,
    })) {
      if (value !== undefined) figures[name] = value;
    }
    const podCost = usage.pod === undefined ? undefined : usage.podCosts?.[usage.pod];
    this.#update(run, {
      status: "closed",
      closedAt: this.#now(),
      cost: usage.cost,
      ...figures,
      ...(usage.pod ? { pod: usage.pod } : {}),
      ...(podCost === undefined ? {} : { podCost }),
    });
    if (agentJob !== "" && agentJob !== "success") {
      this.#event(run, "run-stopped", { result: agentJob });
    }
    this.#event(run, "run-closed", { cost: usage.cost });
    this.#pods(run, usage.pods);
  }

  /** `release-pod` released the run's kept pod. */
  release(run: string, pods: readonly PodEvent[]): void {
    this.#pods(run, pods);
  }

  /**
   * Writes what the job recorded, at once, trying again on failure; throws when it still fails,
   * which fails the job.
   */
  async flush(log: Log): Promise<void> {
    const writes = this.#writes;
    if (writes.length === 0) return;
    // A commit takes at most 500 writes.
    for (let start = 0; start < writes.length; start += 500) {
      const batch = writes.slice(start, start + 500);
      await this.#retry(log, "write to Codeman's ledger", () => this.#store.write(batch));
    }
    this.#writes = [];
    log.info(`Recorded ${writes.length} document(s) in Codeman's ledger.`);
    const lives = this.#lives;
    this.#lives = [];
    for (const { pod, life } of lives) await this.#untracked(pod, life, log);
  }

  /**
   * Records on a terminated pod's document its time that no task counted (decision 4 of the pod
   * registry plan): its life at its price, less what the ledger's runs on it count, as the
   * budgets count them. It counts in the organization's month of the pod's end. Runs after the
   * job's own runs are written, so they count.
   */
  async #untracked(pod: string, life: PodLife, log: Log): Promise<void> {
    const { owner } = this.#source.runtime.repository;
    await this.#retry(log, "write to Codeman's ledger", async () => {
      const runs = ledgerRuns(
        await this.#store.query(LAYOUT.runs(owner), {
          where: [{ field: "pod", op: "==", value: pod }],
        }),
      );
      const lifeCost = (Math.max(0, life.to - life.from) / 1000) * life.pricePerSecond;
      const counted = spentBy(runs);
      const untracked = Math.max(0, lifeCost - counted);
      await this.#store.write([
        {
          op: "set",
          path: LAYOUT.pod(owner, life.record),
          fields: {
            pod,
            provider: life.provider,
            createdAt: new Date(life.from),
            pricePerSecond: life.pricePerSecond,
            terminatedAt: new Date(life.to),
            month: ledgerMonth(new Date(life.to)),
            lifeCost: round(lifeCost),
            counted: round(counted),
            untracked: round(untracked),
          },
          merge: true,
        },
      ]);
      log.info(
        `Pod ${pod} cost about ${usd(lifeCost)}, of which its tasks count ${usd(counted)}; the organization's month counts the other ${usd(untracked)}.`,
      );
    });
  }

  #repository(): string {
    return repositoryName(this.#source.runtime.repository);
  }

  /** Adds fields to a run's document, which replace those of the same name. */
  #update(run: string, fields: Fields): void {
    this.#writes.push({
      op: "set",
      path: LAYOUT.run(this.#source.runtime.repository.owner, run),
      fields,
      merge: true,
    });
  }

  /** What happened to a run; `subject` tells apart events of one type, such as each pod's. */
  #event(run: string, type: EventType, fields: Fields, subject?: string): void {
    const { repository, run: workflowRun } = this.#source.runtime;
    this.#writes.push({
      op: "set",
      path: LAYOUT.event(repository.owner, `${run}-${type}${subject ? `-${subject}` : ""}`),
      fields: {
        type,
        repository: repositoryName(repository),
        task: taskOf(run),
        run,
        workflowRun: workflowRun.id,
        attempt: workflowRun.attempt,
        job: this.#source.job,
        at: this.#now(),
        ...fields,
      },
    });
  }

  #pods(run: string, events: readonly PodEvent[] | undefined): void {
    for (const { pod, event, reason, life } of events ?? []) {
      this.#event(run, `pod-${event}`, { pod, ...(reason ? { reason } : {}) }, pod);
      if (event === "terminated" && life) this.#lives.push({ pod, life });
    }
  }

  async #retry<T>(log: Log, what: string, call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        const message = oneLine(error instanceof Error ? error.message : String(error));
        const wait = RETRY_MS[attempt];
        if (wait === undefined) {
          throw new Error(`Could not ${what} after ${attempt + 1} attempts: ${message}`);
        }
        log.warning(`Could not ${what} (${message}); trying again in ${wait / 1000} s.`);
        await this.#wait(wait);
      }
    }
  }
}

/**
 * The run's ID in the ledger, from `select` through the step's `ledger-run` input; it ends with
 * the step's `task`, when it has one.
 */
export function ledgerRun(runtime: Pick<Runtime, "input">): string {
  const run = runtime.input("ledger-run");
  if (!isLedgerRunId(run)) {
    throw new Error(
      "Input ledger-run must be the run's ID in the ledger, from select; copy the workflow templates again if yours do not pass it.",
    );
  }
  const task = runtime.input("task");
  if (task !== "" && String(taskOf(run)) !== task) {
    throw new Error(`Input ledger-run names a run of #${taskOf(run)}, not of #${task}.`);
  }
  return run;
}

/** The task of a run's ID: its last part. */
function taskOf(run: string): number {
  return Number(run.slice(run.lastIndexOf("-") + 1));
}

/** A repository's runs of one task. */
function taskQuery(
  store: StoreReader,
  owner: string,
  repository: string,
  task: number,
): Promise<StoredDocument[]> {
  return store.query(LAYOUT.runs(owner), {
    where: [
      { field: "repository", op: "==", value: repository },
      { field: "task", op: "==", value: task },
    ],
  });
}

/** The organization's runs of a month, or one repository's. */
function monthQuery(
  store: StoreReader,
  owner: string,
  month: string,
  repository?: string,
): Promise<StoredDocument[]> {
  return store.query(LAYOUT.runs(owner), {
    where: [
      { field: "month", op: "==", value: month },
      ...(repository === undefined
        ? []
        : [{ field: "repository", op: "==" as const, value: repository }]),
    ],
  });
}

/** Runs as the budgets read them, in the order they started; documents without a run's fields are left out. */
export function ledgerRuns(documents: readonly StoredDocument[]): LedgerRun[] {
  const runs = documents.flatMap((document): LedgerRun[] => {
    const { fields } = document;
    const id = document.path.slice(document.path.lastIndexOf("/") + 1);
    const text = (value: unknown) => (typeof value === "string" ? value : undefined);
    const amount = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
    const date = (value: unknown) => (value instanceof Date ? value : undefined);
    const repository = text(fields.repository);
    const task = fields.task;
    const start = date(fields.reservedAt) ?? date(fields.openedAt) ?? date(fields.pickedAt);
    if (!repository || typeof task !== "number" || !start) return [];
    return [
      {
        id,
        repository,
        task,
        workflowRun: text(fields.workflowRun) ?? "",
        status: text(fields.status) ?? "",
        provider: text(fields.provider) ?? "",
        limit: amount(fields.limit),
        cost: amount(fields.cost),
        spentBefore: amount(fields.spentBefore),
        carried: amount(fields.carried),
        pod: text(fields.pod),
        podCost: amount(fields.podCost),
        start,
        // Runs opened before reservations expire as theirs would.
        expiresAt: date(fields.expiresAt) ?? new Date(start.getTime() + RESERVATION_MS),
        closedAt: date(fields.closedAt),
      },
    ];
  });
  return runs.sort((a, b) => a.start.getTime() - b.start.getTime() || (a.id < b.id ? -1 : 1));
}

/** The organization's pods that ended in a month, with their time no task counted. */
function untrackedQuery(
  store: StoreReader,
  owner: string,
  month: string,
): Promise<StoredDocument[]> {
  return store.query(LAYOUT.pods(owner), {
    where: [{ field: "month", op: "==", value: month }],
  });
}

/**
 * Pods' time no task counted, as runs of no repository or task that the organization's month
 * counts: each spreads over its pod's life.
 */
export function untrackedRuns(documents: readonly StoredDocument[]): LedgerRun[] {
  return documents.flatMap((document): LedgerRun[] => {
    const { fields } = document;
    const { pod, provider, untracked, createdAt, terminatedAt } = fields;
    if (typeof pod !== "string" || typeof provider !== "string") return [];
    if (typeof untracked !== "number" || !Number.isFinite(untracked) || untracked <= 0) return [];
    if (!(createdAt instanceof Date) || !(terminatedAt instanceof Date)) return [];
    return [
      {
        id: `pod-${document.path.slice(document.path.lastIndexOf("/") + 1)}`,
        repository: "",
        task: 0,
        workflowRun: "",
        status: "closed",
        provider,
        cost: untracked,
        pod,
        start: createdAt,
        expiresAt: terminatedAt,
        closedAt: terminatedAt,
      },
    ];
  });
}

/** Rounds an amount in USD as the ledger keeps it. */
function round(amount: number): number {
  return Number(amount.toFixed(6));
}
