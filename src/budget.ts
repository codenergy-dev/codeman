export type Fetch = typeof fetch;

/** Below this, a run is not worth starting: it would stop midway. */
export const MIN_RUN_BUDGET = 0.1;

/**
 * The limit for the next run's key: what remains of the task's budget, in whole cents rounded
 * down, or undefined when that is below MIN_RUN_BUDGET.
 */
export function runLimit(taskBudget: number, spent: number): number | undefined {
  const remaining = Math.floor((taskBudget - spent) * 100 + 1e-9) / 100;
  return remaining >= MIN_RUN_BUDGET ? remaining : undefined;
}

export function usd(amount: number): string {
  return `US$ ${amount.toFixed(2)}`;
}
