import type { Log } from "../runtime/runtime.ts";

/**
 * Where a task's agent runs get their model, and how what they spend is counted: OpenRouter, or
 * a model Codeman serves on rented GPUs. The key jobs (`open-key`, `close-key`) are the only
 * ones that use it. See docs/architecture.md#budget.
 */
export interface InferenceProvider {
  readonly name: string;
  /** What the task has spent so far, in USD, across all its runs. */
  taskSpent(task: string): Promise<number>;
  /** What the repository, or the account it shares, has spent this calendar month, in USD. */
  monthSpent(): Promise<number>;
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
  /** What each run of the task spent, by run ID, when the provider can tell. */
  taskCosts?: Record<string, number> | undefined;
  /** The pod that served the run, for a provider that bills pods. */
  pod?: string | undefined;
  /** What each of the task's pods was billed so far, by pod ID. */
  podCosts?: Record<string, number> | undefined;
  /** The pod kept for the task's next run, which `release-pod` terminates if none follows. */
  keptPod?: string | undefined;
}
