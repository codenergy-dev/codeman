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

/**
 * How long a run's reservation holds: longer than a run lasts, from `open-key` (35 minutes at
 * most) through the agent (60) to `close-key` (10), with the waits between the jobs.
 */
export const RESERVATION_MS = 2 * 3_600_000;

const HOUR_MS = 3_600_000;

/** A run of Codeman's ledger, as the budgets read it (docs/architecture.md#the-ledger). */
export interface LedgerRun {
  id: string;
  /** `owner/name`, lowercase; empty for a pod's time no task counted, the organization's. */
  repository: string;
  /** The task's issue; 0 for a pod's time no task counted. */
  task: number;
  workflowRun: string;
  /** `picked`, `open`, `refused`, `failed`, `closed` or `expired`. */
  status: string;
  /**
   * The account the run's provider bills: `openrouter`, or `runpod` for pods and Serverless
   * endpoints.
   */
  account: string;
  /** What the run may spend, once `open-key` reserved it. */
  limit?: number | undefined;
  /** What the run spent, once closed; for an expired run, what OpenRouter's keys said since. */
  cost?: number | undefined;
  /** What an earlier attempt of the run spent, when `open-key` ran again after it closed. */
  spentBefore?: number | undefined;
  /** What the task's record counted before the ledger, on the task's first run under it. */
  carried?: number | undefined;
  pod?: string | undefined;
  /** What the task's pod cost as `close-key` last read it: billed, or estimated when higher. */
  podCost?: number | undefined;
  /** When the run started to cost: its reservation, or for older runs, its opening or pick. */
  start: Date;
  /** When its reservation expires; a run that never closed counts its limit from then on. */
  expiresAt: Date;
  closedAt?: Date | undefined;
}

/** What a run counts: its cost once known, its limit while open, and what it spent before. */
export function runAmount(run: LedgerRun): number {
  const own = run.cost ?? (run.status === "open" ? (run.limit ?? 0) : 0);
  return (run.spentBefore ?? 0) + own;
}

/** Whether the run holds a reservation at `now`: open, with no cost yet, and not expired. */
export function reserving(run: LedgerRun, now: Date): boolean {
  return run.status === "open" && run.cost === undefined && run.expiresAt > now;
}

/** Whether the run's reservation expired before it closed: it counts its whole limit. */
export function expired(run: LedgerRun, now: Date): boolean {
  return run.status === "open" && run.cost === undefined && run.expiresAt <= now;
}

/** Runs the budgets count together: a run alone, or a task's runs on one pod. */
interface Counted {
  runs: LedgerRun[];
  amount: number;
}

/**
 * The runs as the budgets count them. A task's pod costs while it is kept between runs, which no
 * run's cost includes, so a task's runs on one pod count the higher of their amounts and what
 * `close-key` last read of the pod's cost.
 */
function counted(runs: readonly LedgerRun[]): Counted[] {
  const alone: Counted[] = [];
  const onPods = new Map<string, LedgerRun[]>();
  for (const run of runs) {
    if (!run.pod) {
      alone.push({ runs: [run], amount: runAmount(run) });
      continue;
    }
    const key = JSON.stringify([run.repository, run.task, run.pod]);
    onPods.set(key, [...(onPods.get(key) ?? []), run]);
  }
  const pods = [...onPods.values()].map((group) => ({
    runs: group,
    amount: Math.max(
      group.reduce((sum, run) => sum + runAmount(run), 0),
      ...group.map((run) => run.podCost ?? 0),
    ),
  }));
  return [...alone, ...pods];
}

/** What the runs spent together, open runs' limits included. */
export function spentBy(runs: readonly LedgerRun[]): number {
  return counted(runs).reduce((sum, group) => sum + group.amount, 0);
}

/** A task's total: its runs, and what its record counted before the ledger. */
export function taskTotal(runs: readonly LedgerRun[]): number {
  return spentBy(runs) + runs.reduce((sum, run) => sum + (run.carried ?? 0), 0);
}

/**
 * What each of a task's workflow runs spent, by workflow run ID, rounded as `run-cost` is, for
 * the spend table: a run alone on its pod counts the pod's cost, like the task's total.
 */
export function costsByWorkflowRun(runs: readonly LedgerRun[]): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const group of counted(runs)) {
    for (const run of group.runs) {
      const amount = group.runs.length === 1 ? group.amount : runAmount(run);
      costs[run.workflowRun] = (costs[run.workflowRun] ?? 0) + amount;
    }
  }
  return Object.fromEntries(
    Object.entries(costs).map(([run, cost]) => [run, Number(cost.toFixed(4))]),
  );
}

/** What a GPU account billed, in USD, by the start of each hour (milliseconds). */
export type BilledHours = ReadonlyMap<number, number>;

/**
 * The organization's month (decision 2 of the ledger budgets plan): what its runs spent, with
 * the runs of each GPU account in `billed` reconciled with its account's billing. Their amounts
 * spread evenly over their time (a task's pod over its runs' span); each hour the account billed
 * counts the higher of its bill and the runs' estimate, so a pod's time no run accounts for still
 * counts, and each other hour counts the estimate, so a run counts as soon as it ends. Open
 * reservations count whole: their runs may still spend.
 */
export function reconciledMonth(
  runs: readonly LedgerRun[],
  billed: ReadonlyMap<string, BilledHours>,
  now: Date,
): number {
  let total = 0;
  const estimates = new Map<string, Map<number, number>>();
  for (const group of counted(runs)) {
    const [first] = group.runs;
    const hours = first && billed.get(first.account);
    if (!first || !hours || group.runs.some((run) => reserving(run, now))) {
      total += group.amount;
      continue;
    }
    const start = Math.min(...group.runs.map((run) => run.start.getTime()));
    const end = Math.max(...group.runs.map((run) => endOf(run, now).getTime()));
    let estimate = estimates.get(first.account);
    if (!estimate) {
      estimate = new Map();
      estimates.set(first.account, estimate);
    }
    spread(estimate, group.amount, start, end);
  }
  for (const [provider, hours] of billed) {
    const estimate = estimates.get(provider) ?? new Map<number, number>();
    for (const hour of new Set([...hours.keys(), ...estimate.keys()])) {
      const bill = hours.get(hour) ?? 0;
      total += Math.max(bill, estimate.get(hour) ?? 0);
    }
  }
  return total;
}

/** When a run stopped costing: its close, or its reservation's expiry when it never closed. */
function endOf(run: LedgerRun, now: Date): Date {
  return run.closedAt ?? (run.expiresAt < now ? run.expiresAt : now);
}

/** Adds `amount` to the hours from `start` to `end`, in proportion to the time in each. */
function spread(hours: Map<number, number>, amount: number, start: number, end: number): void {
  if (amount <= 0) return;
  const add = (hour: number, part: number) => hours.set(hour, (hours.get(hour) ?? 0) + part);
  const first = start - (start % HOUR_MS);
  if (end <= start) {
    add(first, amount);
    return;
  }
  for (let hour = first; hour < end; hour += HOUR_MS) {
    const overlap = Math.min(end, hour + HOUR_MS) - Math.max(start, hour);
    add(hour, (amount * overlap) / (end - start));
  }
}

/** The start of the calendar month (UTC) of `date`. */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
