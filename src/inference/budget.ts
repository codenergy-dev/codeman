import type { InferenceProvider } from "./provider.ts";

/** What one provider's account spent this calendar month, in USD. */
export interface MonthSpend {
  provider: string;
  spent: number;
}

/**
 * The task's and the month's spend across every provider the settings and their profiles name,
 * as the key jobs check them against the budgets (decision 6 of the inference profiles plan).
 */
export interface InferenceBudget {
  /** The secrets of providers the settings name that the job was not given. */
  readonly missing: readonly string[];
  /** What the task spent so far, in USD, whatever served its runs. */
  taskSpent(task: string): Promise<number>;
  /** Each provider's month: they add up against the one monthly budget. */
  monthSpent(): Promise<MonthSpend[]>;
}

/** A provider the budgets read: an inference provider, or only a GPU account's month. */
export type ProviderAccount =
  | { name: string; provider: InferenceProvider }
  | { name: string; month: () => Promise<number> };

/**
 * The budgets from the providers' accounts and the task's record. The task's total is what its
 * OpenRouter keys spent, when OpenRouter is named, plus what the record says self-hosted runs
 * added; without OpenRouter, the record's total.
 */
export class ProviderBudget implements InferenceBudget {
  readonly missing: readonly string[];
  readonly #recorded: { spent: number; selfHosted: number };
  readonly #accounts: readonly ProviderAccount[];

  constructor(
    recorded: { spent: number; selfHosted: number },
    accounts: readonly ProviderAccount[],
    missing: readonly string[] = [],
  ) {
    this.#recorded = recorded;
    this.#accounts = accounts;
    this.missing = missing;
  }

  async taskSpent(task: string): Promise<number> {
    const openRouter = this.#accounts.find((account) => account.name === "openrouter");
    if (!openRouter || !("provider" in openRouter)) return this.#recorded.spent;
    return (await openRouter.provider.taskSpent(task)) + this.#recorded.selfHosted;
  }

  async monthSpent(): Promise<MonthSpend[]> {
    return Promise.all(
      this.#accounts.map(async (account) => ({
        provider: account.name,
        spent: await ("provider" in account ? account.provider.monthSpent() : account.month()),
      })),
    );
  }
}
