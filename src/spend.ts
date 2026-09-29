import type { Messages } from "./i18n/index.ts";
import type { Stage } from "./stages.ts";

/** What one agent run spent, and the limits that applied to it. */
export interface SpendRow {
  runUrl: string;
  /** When the run ended, as an ISO timestamp. */
  at: string;
  stage: Stage | "plan";
  model: string;
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
}

/** Sums over several runs. */
export interface SpendTotals {
  runs: number;
  cost: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
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

/** Everything the table knows: the folded rows and each row. */
export function spendTotals(spending: Spending | undefined): SpendTotals {
  return (spending?.rows ?? []).reduce(add, complete(spending?.earlier));
}

function add(totals: SpendTotals, row: SpendRow): SpendTotals {
  return {
    runs: totals.runs + 1,
    cost: totals.cost + (row.cost ?? 0),
    durationMs: totals.durationMs + (row.durationMs ?? 0),
    inputTokens: totals.inputTokens + (row.inputTokens ?? 0),
    outputTokens: totals.outputTokens + (row.outputTokens ?? 0),
  };
}

/** Older records folded only runs and cost. */
function complete(totals: Partial<SpendTotals> | undefined): SpendTotals {
  return {
    runs: totals?.runs ?? 0,
    cost: totals?.cost ?? 0,
    durationMs: totals?.durationMs ?? 0,
    inputTokens: totals?.inputTokens ?? 0,
    outputTokens: totals?.outputTokens ?? 0,
  };
}

/**
 * The spend table in Markdown. With the task's total from OpenRouter, a last row shows what
 * runs without a row spent, such as a run whose apply failed.
 */
export function spendTable(t: Messages, spending: Spending | undefined, total?: number): string[] {
  const rows = spending?.rows ?? [];
  const earlier = spending?.earlier;
  const dash = (value: number | undefined, format: (value: number) => string) =>
    value === undefined ? "—" : format(value);
  const lines = [
    `| ${t.tableHeader.join(" | ")} |`,
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  if (earlier?.runs) {
    // Records from before time and tokens were kept folded only runs and cost.
    lines.push(
      `| ${t.earlierRuns(earlier.runs)} | | | ${dash(earlier.durationMs, duration)} | ${dash(earlier.inputTokens, t.tokens)} | ${dash(earlier.outputTokens, t.tokens)} | ${t.cost(earlier.cost ?? 0)} | | | |`,
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
        dash(row.durationMs, duration),
        dash(row.inputTokens, t.tokens),
        dash(row.outputTokens, t.tokens),
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
  const recorded = spendTotals(spending).cost;
  if (total !== undefined && total - recorded >= 0.001) {
    lines.push(`| ${t.runsWithoutRow} | | | | | | ${t.cost(total - recorded)} | | | |`);
  }
  return lines;
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
