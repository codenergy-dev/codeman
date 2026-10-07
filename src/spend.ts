import type { Messages } from "./i18n/index.ts";
import type { AgentMode } from "./inference/index.ts";
import type { Stage } from "./stages.ts";

/** What one agent run spent, and the limits that applied to it. */
export interface SpendRow {
  runUrl: string;
  /** When the run ended, as an ISO timestamp. */
  at: string;
  stage: Stage | "plan" | "route";
  model: string;
  /** Where the run's model was served; rows recorded before it was kept have none. */
  inference?: AgentMode | undefined;
  /** Undefined when the run's cost could not be read. */
  cost?: number | undefined;
  keyLimit?: number | undefined;
  taskBudget: number;
  monthlyBudget: number;
  /** What the repository spent this month before the run. */
  monthSpent?: number | undefined;
  /** How long the agent ran. */
  durationMs?: number | undefined;
  /** Tokens, as OpenRouter's analytics counts them. */
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  /** Requests made with the run's key, which weigh its throughput in the task's mean. */
  requests?: number | undefined;
  /** The run's context length: the input tokens of its largest request. */
  maxInputTokens?: number | undefined;
  /** Mean completion tokens per second over the run's requests. */
  tokensPerSecond?: number | undefined;
}

/** Sums over several runs. */
export interface SpendTotals {
  runs: number;
  cost: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** The largest context length; 0 when no run has one. */
  maxInputTokens: number;
  /** Throughput times requests, over the runs with both: a request-weighted mean's numerator. */
  throughputSum: number;
  /** Requests of the runs counted in `throughputSum`. */
  throughputRequests: number;
}

/** The mean tokens per second over every measured request; undefined when none was. */
export function meanThroughput(totals: SpendTotals): number | undefined {
  return totals.throughputRequests > 0
    ? totals.throughputSum / totals.throughputRequests
    : undefined;
}

/** A task's spend table, as kept in its record: the newest rows, and the older ones folded. */
export interface Spending {
  rows: SpendRow[];
  earlier?: Partial<SpendTotals> | undefined;
}

/** Rows kept in the record; the status comment, which holds it, has a size limit. */
export const MAX_ROWS = 30;

/** Adds a run's row, folding the oldest rows into `earlier` past `max`. */
export function addRow(spending: Spending | undefined, row: SpendRow, max = MAX_ROWS): Spending {
  const rows = [...(spending?.rows ?? []), row];
  let earlier = spending?.earlier;
  while (rows.length > max) {
    const oldest = rows.shift();
    if (oldest) earlier = add(complete(earlier), oldest);
  }
  return { rows, earlier };
}

/**
 * Takes each row's cost from `costs`, what each run of the task spent by run ID as OpenRouter
 * counts it now, since a run may have read its cost before OpenRouter counted it. A run with
 * several rows, such as a re-run, keeps them as they are: its cost cannot be split between them.
 * Folded rows stay folded.
 */
export function refreshCosts(
  spending: Spending,
  costs: Readonly<Record<string, number>>,
  runIdOf: (runUrl: string) => string | undefined,
): Spending {
  const rowsOf = new Map<string, number>();
  for (const row of spending.rows) {
    const run = runIdOf(row.runUrl);
    if (run) rowsOf.set(run, (rowsOf.get(run) ?? 0) + 1);
  }
  const rows = spending.rows.map((row) => {
    const run = runIdOf(row.runUrl);
    const cost = run && rowsOf.get(run) === 1 && Object.hasOwn(costs, run) ? costs[run] : undefined;
    return cost === undefined ? row : { ...row, cost };
  });
  return { ...spending, rows };
}

/**
 * `close-key`'s `task-costs` output: a JSON object of costs in USD by run ID. Undefined when
 * missing, as with older workflow files, empty (the run's own key is always there) or malformed.
 */
export function parseCosts(text: string): Record<string, number> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  const valid = entries.every(
    ([run, cost]) =>
      /^\d+$/.test(run) && typeof cost === "number" && Number.isFinite(cost) && cost >= 0,
  );
  return valid && entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Everything the table knows: the folded rows and each row. */
export function spendTotals(spending: Spending | undefined): SpendTotals {
  return (spending?.rows ?? []).reduce(add, complete(spending?.earlier));
}

function add(totals: SpendTotals, row: SpendRow): SpendTotals {
  const weighed = row.tokensPerSecond !== undefined && (row.requests ?? 0) > 0;
  return {
    runs: totals.runs + 1,
    cost: totals.cost + (row.cost ?? 0),
    durationMs: totals.durationMs + (row.durationMs ?? 0),
    inputTokens: totals.inputTokens + (row.inputTokens ?? 0),
    outputTokens: totals.outputTokens + (row.outputTokens ?? 0),
    maxInputTokens: Math.max(totals.maxInputTokens, row.maxInputTokens ?? 0),
    throughputSum:
      totals.throughputSum + (weighed ? (row.tokensPerSecond ?? 0) * (row.requests ?? 0) : 0),
    throughputRequests: totals.throughputRequests + (weighed ? (row.requests ?? 0) : 0),
  };
}

/** Older records folded only runs and cost, and later ones no context or throughput. */
function complete(totals: Partial<SpendTotals> | undefined): SpendTotals {
  return {
    runs: totals?.runs ?? 0,
    cost: totals?.cost ?? 0,
    durationMs: totals?.durationMs ?? 0,
    inputTokens: totals?.inputTokens ?? 0,
    outputTokens: totals?.outputTokens ?? 0,
    maxInputTokens: totals?.maxInputTokens ?? 0,
    throughputSum: totals?.throughputSum ?? 0,
    throughputRequests: totals?.throughputRequests ?? 0,
  };
}

/**
 * The spend table in Markdown. With the task's total from OpenRouter, a row shows what runs
 * without a row spent, such as a run whose apply failed. With `totals`, a last row totals every
 * column over all the task's runs: sums, the largest context, and the request-weighted mean
 * throughput. Limits and budgets are not amounts, so it leaves them empty.
 */
export function spendTable(
  t: Messages,
  spending: Spending | undefined,
  total?: number,
  options: { totals?: boolean } = {},
): string[] {
  const rows = spending?.rows ?? [];
  const earlier = spending?.earlier;
  const dash = (value: number | undefined, format: (value: number) => string) =>
    value === undefined ? "—" : format(value);
  // Zero means "never recorded" for folded figures that older records lack.
  const known = (value: number | undefined) => (value ? value : undefined);
  const lines = [
    `| ${t.tableHeader.join(" | ")} |`,
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  if (earlier?.runs) {
    // Records from before time, tokens, context and throughput were kept folded fewer sums.
    const folded = complete(earlier);
    lines.push(
      `| ${t.earlierRuns(earlier.runs)} | | | | ${dash(earlier.durationMs, duration)} | ${dash(earlier.inputTokens, t.tokens)} | ${dash(earlier.outputTokens, t.tokens)} | ${dash(known(folded.maxInputTokens), t.tokens)} | ${dash(meanThroughput(folded), t.rate)} | ${t.cost(earlier.cost ?? 0)} | | | |`,
    );
  }
  for (const row of rows) {
    const month =
      row.monthSpent === undefined
        ? t.money(row.monthlyBudget)
        : t.of(t.money(row.monthSpent), t.money(row.monthlyBudget));
    const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row.at) ? t.dateTime(row.at) : "—";
    lines.push(
      [
        "",
        `[${when}](${row.runUrl})`,
        t.stage(row.stage),
        `\`${row.model.replace(/[`|\s]/g, "")}\``,
        row.inference ? t.provider(row.inference) : "—",
        dash(row.durationMs, duration),
        dash(row.inputTokens, t.tokens),
        dash(row.outputTokens, t.tokens),
        dash(row.maxInputTokens, t.tokens),
        dash(row.tokensPerSecond, t.rate),
        dash(row.cost, t.cost),
        dash(row.keyLimit, t.money),
        t.money(row.taskBudget),
        month,
        "",
      ]
        .join(" | ")
        .trim(),
    );
  }
  const sums = spendTotals(spending);
  const missing = total !== undefined && total - sums.cost >= 0.001 ? total - sums.cost : 0;
  if (missing > 0) {
    lines.push(`| ${t.runsWithoutRow} | | | | | | | | | ${t.cost(missing)} | | | |`);
  }
  if (options.totals && sums.runs > 0) {
    lines.push(
      `| **${t.totalRow(sums.runs)}** | | | | ${dash(known(sums.durationMs), duration)} | ${dash(known(sums.inputTokens), t.tokens)} | ${dash(known(sums.outputTokens), t.tokens)} | ${dash(known(sums.maxInputTokens), t.tokens)} | ${dash(meanThroughput(sums), t.rate)} | **${t.cost(sums.cost + missing)}** | | | |`,
    );
  }
  return lines;
}

/** The order of the notes under the table. */
const MODES: readonly AgentMode[] = ["openrouter", "pod", "serverless"];

/**
 * How the cost and the month are measured for each inference the table's rows used, since
 * some figures are estimates. Folded rows and rows recorded before the inference was kept add no
 * note.
 */
export function spendNotes(t: Messages, spending: Spending | undefined): string[] {
  const used = new Set((spending?.rows ?? []).map((row) => row.inference));
  return MODES.filter((mode) => used.has(mode)).map((mode) => t.spendNote(mode));
}

/**
 * A duration as a person would say it: `45 s` under a minute, `1 min 10 s` under an hour, and
 * `1 h 5 min` from there. The units read the same in English and Portuguese.
 */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) {
    const rest = seconds % 60;
    return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ""}`;
  }
  const minutes = Math.round(seconds / 60);
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}
