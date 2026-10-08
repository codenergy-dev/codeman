import type { BilledHours } from "../budget.ts";

/**
 * What the key jobs read from the providers' accounts for the budgets, beside Codeman's ledger,
 * which holds the budgets' figures (docs/budget/budget.md): OpenRouter's keys, which tell
 * what its runs cost, and each GPU account's hourly billing, which reconciles the organization's
 * month.
 */
export interface ProviderAccounts {
  /** The secret the job lacks to reach `account`; undefined when it has it. */
  missing(account: string): string | undefined;
  /**
   * What each run of the task spent on OpenRouter, by workflow run ID, from its keys; undefined
   * when the job has no OpenRouter management key.
   */
  taskCosts(task: string): Promise<Record<string, number> | undefined>;
  /** What a GPU account billed each hour from `start` until `end`. */
  billedHours(account: string, start: Date, end: Date): Promise<BilledHours>;
}
