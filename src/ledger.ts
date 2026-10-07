import { setTimeout as sleep } from "node:timers/promises";
import type { PodEvent, RunUsage } from "./inference/provider.ts";
import type { Log, Runtime } from "./runtime/runtime.ts";
import { isLedgerRunId, LAYOUT, repositoryName } from "./store/layout.ts";
import type { Fields, Store, Write } from "./store/store.ts";
import { oneLine } from "./text.ts";

/** What can happen to a run, as its events name it. */
export type EventType =
  | "task-picked"
  | "key-opened"
  | "key-refused"
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

/** Waits between attempts to reach the store: four attempts in all. */
const RETRY_MS = [1_000, 3_000, 9_000];

/**
 * Codeman's record of its runs, in the store (step 6 of the backend plan): a document for each
 * run of a task's agent, and its events. Each job adds what it knows to the run's document and
 * says what it did; the ledger keeps it until `flush`, which a job calls after its GitHub
 * writes, so a store that fails fails the job without leaving GitHub half written. Writes are
 * idempotent, so a re-run job writes the same documents again: a run's fields are merged, and an
 * event's ID is its run and what happened. Nothing reads the ledger yet.
 */
export class Ledger {
  readonly #store: Store;
  readonly #source: LedgerSource;
  readonly #now: () => Date;
  readonly #wait: (ms: number) => Promise<void>;
  #writes: Write[] = [];

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
        month: at.toISOString().slice(0, 7),
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

  /** `open-key` gave the run its access, limited to `limit` USD. */
  open(run: string, limit: number, pods: readonly PodEvent[] | undefined): void {
    this.#update(run, { status: "open", openedAt: this.#now(), limit });
    this.#event(run, "key-opened", { limit });
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
    this.#update(run, {
      status: "closed",
      closedAt: this.#now(),
      cost: usage.cost,
      ...figures,
      ...(usage.pod ? { pod: usage.pod } : {}),
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
    for (const { pod, event } of events ?? []) this.#event(run, `pod-${event}`, { pod }, pod);
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
