import type { Messages } from "./i18n/index.ts";
import { encodeStatus, pendingDecisions, type TaskRecord } from "./record.ts";
import { type SpendRow, spendTable } from "./spend.ts";
import type { State } from "./state.ts";
import { inertLines, inlineText } from "./text.ts";

export interface StatusView {
  /** The task's language. */
  t: Messages;
  state: State | "new";
  record?: TaskRecord | undefined;
  model: string;
  runUrl: string;
  planUrl?: string | undefined;
  pullRequestUrl?: string | undefined;
  /** A note from Codeman itself (trusted text). */
  message?: string | undefined;
  /** Workflows the agent wrote that wait for `/codeman accept-workflows`. Untrusted names. */
  staged?: readonly string[] | undefined;
  /** What the task spent, in USD, when known. */
  cost?: Cost | undefined;
  /** The newest run comment. */
  reportUrl?: string | undefined;
}

/** What a run and its task spent, in USD, as far as known. */
export interface Cost {
  run?: number | undefined;
  task?: number | undefined;
  budget: number;
}

/**
 * The task's panel: the single comment Codeman keeps up to date on each task, with where the
 * task is now. What each run did goes in a run comment of its own.
 */
export function renderStatus(view: StatusView): string {
  const { record, t } = view;
  const lines = [encodeStatus(record), `### Codeman: ${t.heading(view.state)}`, ""];

  if (view.message) lines.push(view.message, "");
  if (record && view.planUrl) lines.push(`${t.plan}: [${record.planPath}](${view.planUrl})`, "");
  if (record?.pullRequest && view.pullRequestUrl) {
    lines.push(`${t.pullRequest}: [#${record.pullRequest}](${view.pullRequestUrl})`, "");
  }
  if (record) lines.push(inlineText(record.summary), "");

  if (record && record.decisions.length > 0) {
    lines.push(`#### ${t.decisions}`, "");
    for (const decision of record.decisions) {
      lines.push(`**${decision.id}. ${inlineText(decision.title)}**`, "");
      lines.push(inlineText(decision.question), "");
      for (const option of decision.options) {
        const tags = [
          option.key === decision.recommendation ? t.recommended : "",
          option.key === decision.answer?.option ? t.chosenBy(decision.answer.by) : "",
        ].filter(Boolean);
        const suffix = tags.length > 0 ? ` _(${tags.join(", ")})_` : "";
        lines.push(`- **${option.key})** ${inlineText(option.label)}${suffix}`);
      }
      if (decision.answer?.text !== undefined) {
        lines.push("", t.answeredBy(decision.answer.by, inlineText(decision.answer.text)));
      }
      lines.push("");
    }
    if (view.state === "awaiting-decision" && pendingDecisions(record).length > 0) {
      lines.push(t.howToAnswer, "");
    }
  }

  if (view.staged && view.staged.length > 0) {
    lines.push(`#### ${t.workflowsToReview}`, "");
    for (const path of view.staged) lines.push(`- ${inlineText(path)}`);
    lines.push("", t.workflowsHelp, "");
  }

  if (record?.spending?.rows.length || view.cost?.task !== undefined) {
    lines.push(`#### ${t.spending}`, "", ...spendTable(t, record?.spending, view.cost?.task), "");
    if (view.cost?.task !== undefined) {
      lines.push(`${spentText(t, { ...view.cost, run: undefined })}.`, "");
    }
  }

  lines.push(t.panelFooter(modelName(view.model), view.runUrl, view.reportUrl));
  return lines.join("\n");
}

/** The link to the task's newest run comment, if it has one. */
export function reportUrl(issueUrl: string, record: TaskRecord | undefined): string | undefined {
  return record?.reportCommentId ? `${issueUrl}#issuecomment-${record.reportCommentId}` : undefined;
}

const RUN_MARKER = "<!-- codeman:run -->";

export function isRunComment(body: string): boolean {
  return body.startsWith(RUN_MARKER);
}

/** A run comment without its marker, as the agent reads it. */
export function runCommentText(body: string): string {
  return body.slice(RUN_MARKER.length).trim();
}

export interface RunView {
  /** The task's language. */
  t: Messages;
  /** What the run worked on, such as "Test stage" (trusted text). */
  title: string;
  /** The task's state once the run ended. */
  state: State | "new";
  model: string;
  runUrl: string;
  /** A note from Codeman itself (trusted text). */
  message?: string | undefined;
  /** The agent's summary. Rendered as untrusted text. */
  report?: string | undefined;
  /** Problems with commands or the agent's output. Rendered as untrusted text. */
  errors?: readonly string[] | undefined;
  cost?: Cost | undefined;
  /** The run's row of the spend table, for a run that used the agent. */
  spend?: SpendRow | undefined;
}

/** What one run did, posted as a new comment so the issue keeps the task's history. */
export function renderRun(view: RunView): string {
  const { t } = view;
  const lines = [RUN_MARKER, `### Codeman: ${view.title}`, "", t.now(t.heading(view.state)), ""];
  if (view.message) lines.push(view.message, "");
  if (view.report) lines.push(`#### ${t.report}`, "", inertLines(view.report), "");
  if (view.errors && view.errors.length > 0) {
    lines.push(`#### ${t.problems}`, "");
    for (const error of view.errors) lines.push(`- ${inlineText(error)}`);
    lines.push("");
  }
  if (view.spend) {
    lines.push(`#### ${t.costHeading}`, "", ...spendTable(t, { rows: [view.spend] }), "");
  }
  const spent =
    view.cost?.task === undefined
      ? undefined
      : spentText(t, view.spend ? { ...view.cost, run: undefined } : view.cost);
  lines.push(t.runFooter(modelName(view.model), spent, view.runUrl));
  return lines.join("\n");
}

function spentText(t: Messages, cost: Cost): string {
  return t.spent({
    run: cost.run === undefined ? undefined : t.money(cost.run),
    task: t.money(cost.task ?? 0),
    budget: t.money(cost.budget),
  });
}

function modelName(model: string): string {
  return model.replace(/`/g, "");
}
