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
}

/** A task's spend table, as kept in its record: the newest rows, and the older ones folded. */
export interface Spending {
  rows: SpendRow[];
  earlier?: { runs: number; cost: number } | undefined;
}

/** Rows kept in the record; the status comment, which holds it, has a size limit. */
export const MAX_ROWS = 30;

/** Adds a run's row, folding the oldest rows into `earlier` past `max`. */
export function addRow(spending: Spending | undefined, row: SpendRow, max = MAX_ROWS): Spending {
  const rows = [...(spending?.rows ?? []), row];
  let earlier = spending?.earlier;
  while (rows.length > max) {
    const oldest = rows.shift();
    earlier = {
      runs: (earlier?.runs ?? 0) + 1,
      cost: (earlier?.cost ?? 0) + (oldest?.cost ?? 0),
    };
  }
  return { rows, earlier };
}

/**
 * The spend table in Markdown. With the task's total from OpenRouter, a last row shows what
 * runs without a row spent, such as a run whose apply failed.
 */
export function spendTable(t: Messages, spending: Spending | undefined, total?: number): string[] {
  const rows = spending?.rows ?? [];
  const earlier = spending?.earlier;
  const lines = [
    `| ${t.tableHeader.join(" | ")} |`,
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
  ];
  if (earlier) {
    lines.push(`| ${t.earlierRuns(earlier.runs)} | | | ${t.cost(earlier.cost)} | | | |`);
  }
  for (const row of rows) {
    const month =
      row.monthSpent === undefined
        ? t.money(row.monthlyBudget)
        : t.of(t.money(row.monthSpent), t.money(row.monthlyBudget));
    const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row.at) ? t.dateTime(row.at) : "—";
    lines.push(
      `| [${when}](${row.runUrl}) | ${t.stage(row.stage)} | \`${row.model.replace(/[`|\s]/g, "")}\` | ${row.cost === undefined ? "—" : t.cost(row.cost)} | ${row.keyLimit === undefined ? "—" : t.money(row.keyLimit)} | ${t.money(row.taskBudget)} | ${month} |`,
    );
  }
  const recorded = rows.reduce((sum, row) => sum + (row.cost ?? 0), earlier?.cost ?? 0);
  if (total !== undefined && total - recorded >= 0.001) {
    lines.push(`| ${t.runsWithoutRow} | | | ${t.cost(total - recorded)} | | | |`);
  }
  return lines;
}
