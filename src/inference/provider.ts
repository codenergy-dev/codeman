import type { Log } from "../runtime/runtime.ts";

/**
 * Where a task's agent runs get their model, and what each run spent: OpenRouter, or a model
 * Codeman serves on rented GPUs. The key jobs (`open-key`, `close-key`) are the only ones that
 * use it; Codeman's ledger adds up what runs spent for the budgets. See
 * docs/architecture.md#budget.
 */
export interface InferenceProvider {
  readonly name: string;
  /** Gives the run its access to a model, limited to `limit` USD. */
  open(run: RunRequest, log: Log): Promise<OpenedRun>;
  /** Ends the run's access, and reads what it used. `handle` is what `open` returned. */
  close(handle: string, log: Log): Promise<RunUsage>;
}

export interface RunRequest {
  /** The task's issue number. */
  task: string;
  /** The ID of the run, as the runtime gives it. */
  runId: string;
  /** What the run may spend, in USD. */
  limit: number;
}

export interface OpenedRun {
  /** What `close` needs to find the run again. Not secret: it travels between jobs in plain text. */
  handle: string;
  /** The agent's credential. Secret: it travels encrypted. */
  credential: string;
  /** The OpenAI-compatible API the agent calls; undefined for the harness's own provider. */
  baseUrl?: string | undefined;
  /** The model's context length, when the provider knows it. */
  contextLength?: number | undefined;
  /** What the provider did with pods to open the run, for the ledger. */
  pods?: PodEvent[] | undefined;
}

/**
 * Something a provider did with a pod: created one, gave a run one it had not created (another
 * task's, or the task's kept pod), or terminated one.
 */
export interface PodEvent {
  pod: string;
  event: "created" | "joined" | "terminated";
  /** Why it terminated the pod. */
  reason?: string | undefined;
  /** A terminated pod's life, when known, whose time no task counted the ledger records. */
  life?: PodLife | undefined;
}

/** A pod's life, from its creation to its termination, in milliseconds since the epoch. */
export interface PodLife {
  /** The pod's document in the registry: the nonce of its admin token. */
  record: string;
  /** The GPU provider. */
  provider: string;
  from: number;
  to: number;
  pricePerSecond: number;
}

/**
 * An open that failed, with what the provider did with pods before, such as a pod it created
 * that never served the model, so the ledger still records them.
 */
export class OpenFailure extends Error {
  readonly pods: PodEvent[];

  constructor(cause: unknown, pods: PodEvent[]) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.pods = pods;
  }
}

/** What a run used, in OpenRouter's terms. Unknown figures are left out. */
export interface RunUsage {
  /** What the run spent, in USD. */
  cost: number;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  /** Requests the run made, which weigh its throughput in the task's mean. */
  requests?: number | undefined;
  /** The input tokens of the run's largest request. */
  maxInputTokens?: number | undefined;
  /** Mean completion tokens per second over the run's requests. */
  tokensPerSecond?: number | undefined;
  /**
   * What each run of the task spent, by workflow run ID, when the provider can tell; they
   * refresh the runs' costs in the ledger.
   */
  taskCosts?: Record<string, number> | undefined;
  /** The pod that served the run, for a provider that bills pods. */
  pod?: string | undefined;
  /**
   * What each of the task's pods cost so far, by pod ID: billed, or estimated when higher; for a
   * pod that serves several tasks, the task's share as its gateway measured it.
   */
  podCosts?: Record<string, number> | undefined;
  /** Whether the run's pod serves several tasks, so its billing is not the task's alone. */
  podShared?: boolean | undefined;
  /** The pod kept for the task's next run, which `release-pod` terminates if none follows. */
  keptPod?: string | undefined;
  /** What the provider did with pods to close the run, for the ledger. */
  pods?: PodEvent[] | undefined;
}
