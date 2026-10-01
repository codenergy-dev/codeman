import type { Messages } from "./i18n/index.ts";
import { type Decision, encodeStatus, pendingDecisions, type TaskRecord } from "./record.ts";
import { duration, type SpendRow, spendTable, spendTotals } from "./spend.ts";
import type { State } from "./state.ts";
import { inlineText, safeInline, safeMarkdown } from "./text.ts";

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
  /** The task's decisions comment. */
  decisionsUrl?: string | undefined;
}

/** GitHub's limit on the size of a comment, in characters. */
export const COMMENT_LIMIT = 65_536;

/** What a run and its task spent, in USD, as far as known. */
export interface Cost {
  run?: number | undefined;
  task?: number | undefined;
  budget: number;
}

/**
 * The task's panel: the single comment Codeman keeps up to date on each task, with where the
 * task is now. What each run did goes in a run comment of its own, and the decisions in the
 * decisions comment.
 */
export function renderStatus(view: StatusView): string {
  const { record, t } = view;
  const head = [encodeStatus(record), `### Codeman: ${t.heading(view.state)}`, ""];
  if (view.message) head.push(view.message, "");
  if (record && view.planUrl) head.push(`${t.plan}: [${record.planPath}](${view.planUrl})`, "");
  if (record?.pullRequest && view.pullRequestUrl) {
    head.push(`${t.pullRequest}: [#${record.pullRequest}](${view.pullRequestUrl})`, "");
  }
  if (record && record.decisions.length > 0 && view.decisionsUrl) {
    const pending = pendingDecisions(record).length;
    head.push(`${t.decisions}: [${t.decisionsLink(pending)}](${view.decisionsUrl})`, "");
  }

  const rest: string[] = [];
  if (record) rest.push(safeInline(record.summary), "");
  if (view.staged && view.staged.length > 0) {
    rest.push(`#### ${t.workflowsToReview}`, "");
    for (const path of view.staged) rest.push(`- ${inlineText(path)}`);
    rest.push("", t.workflowsHelp, "");
  }
  if (record?.spending?.rows.length || view.cost?.task !== undefined) {
    rest.push(`#### ${t.spending}`, "", ...spendTable(t, record?.spending, view.cost?.task), "");
    if (view.cost?.task !== undefined) {
      rest.push(`${spentText(t, { ...view.cost, run: undefined })}.`, "");
    }
    const totals = spendTotals(record?.spending);
    // Rows from before tokens and time were recorded have neither.
    if (totals.inputTokens + totals.outputTokens + totals.durationMs > 0) {
      rest.push(
        t.usedTokens(
          t.tokens(totals.inputTokens),
          t.tokens(totals.outputTokens),
          duration(totals.durationMs),
        ),
        "",
      );
    }
  }

  const footer = t.panelFooter(modelName(view.model), view.runUrl, view.reportUrl);
  const body = [...head, ...rest, footer].join("\n");
  if (body.length <= COMMENT_LIMIT) return body;
  // The record must be kept whole; what the panel shows can be left out.
  const short = [...head, t.panelCut, "", footer].join("\n");
  if (short.length <= COMMENT_LIMIT) return short;
  throw new Error("The task record no longer fits in a GitHub comment.");
}

export interface DecisionsView {
  /** The task's language. */
  t: Messages;
  state: State | "new";
  record: TaskRecord;
}

const DECISIONS_MARKER = "<!-- codeman:decisions -->";

/**
 * The task's decisions, with their answers and how to answer. Codeman keeps this comment up to
 * date from the record and never reads it back.
 */
export function renderDecisions(view: DecisionsView): string {
  const { record, t } = view;
  const head = [DECISIONS_MARKER, `### Codeman: ${t.decisions}`, ""];
  if (record.decisions.length === 0) return [...head, t.noDecisions].join("\n");
  const tail =
    view.state === "awaiting-decision" && pendingDecisions(record).length > 0
      ? [t.howToAnswer]
      : [];
  const render = (blocks: string[][], omitted = 0): string =>
    [...head, ...blocks.flat(), ...(omitted > 0 ? [t.decisionsOmitted(omitted), ""] : []), ...tail]
      .join("\n")
      .trimEnd();

  const full = render(record.decisions.map((decision) => decisionLines(t, decision)));
  if (full.length <= COMMENT_LIMIT) return full;
  // Too long: answered decisions in short form, then fewer of them, then fewer pending ones.
  const shown = record.decisions.map((decision) => ({
    decision,
    lines: decision.answer ? answeredLine(t, decision) : decisionLines(t, decision),
  }));
  const order = [
    ...shown.filter(({ decision }) => decision.answer),
    ...shown.filter(({ decision }) => !decision.answer).reverse(),
  ];
  let omitted = 0;
  let text = render(shown.map(({ lines }) => lines));
  while (text.length > COMMENT_LIMIT && omitted < order.length) {
    const dropped = new Set(order.slice(0, ++omitted));
    text = render(
      shown.filter((entry) => !dropped.has(entry)).map(({ lines }) => lines),
      omitted,
    );
  }
  return text;
}

function decisionLines(t: Messages, decision: Decision): string[] {
  const lines = [
    `**${decision.id}. ${safeInline(decision.title)}**`,
    "",
    safeInline(decision.question),
    "",
  ];
  for (const option of decision.options) {
    const tags = [
      option.key === decision.recommendation ? t.recommended : "",
      option.key === decision.answer?.option ? t.chosenBy(decision.answer.by) : "",
    ].filter(Boolean);
    const suffix = tags.length > 0 ? ` _(${tags.join(", ")})_` : "";
    lines.push(`- **${option.key})** ${safeInline(option.label)}${suffix}`);
  }
  if (decision.answer?.text !== undefined) {
    lines.push("", t.answeredBy(decision.answer.by, inlineText(decision.answer.text)));
  }
  lines.push("");
  return lines;
}

/** An answered decision on one line: its title and the answer. */
function answeredLine(t: Messages, decision: Decision): string[] {
  const answer = decision.answer;
  const option = decision.options.find((candidate) => candidate.key === answer?.option);
  const text =
    answer?.text !== undefined
      ? t.answeredBy(answer.by, inlineText(answer.text))
      : `**${option?.key})** ${safeInline(option?.label ?? "")} _(${t.chosenBy(answer?.by ?? "")})_`;
  return [`**${decision.id}. ${safeInline(decision.title)}**: ${text}`, ""];
}

/**
 * The panel of a labeled issue that a maintainer did not open. It keeps the task's record, and
 * has no run link, so it stays the same from run to run and is written once.
 */
export function renderRefused(t: Messages, record: TaskRecord | undefined): string {
  return [encodeStatus(record), `### Codeman: ${t.refusedHeading}`, "", t.refused].join("\n");
}

/** The link to the task's decisions comment, if it has one. */
export function decisionsUrl(issueUrl: string, record: TaskRecord | undefined): string | undefined {
  return record?.decisionsCommentId
    ? `${issueUrl}#issuecomment-${record.decisionsCommentId}`
    : undefined;
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
  /** What the run worked on and how it ended, such as "Test stage: done" (trusted text). */
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
  const lines = [RUN_MARKER, `### Codeman · ${view.title}`, ""];
  if (view.message) lines.push(view.message, "");
  if (view.report) lines.push(`#### ${t.report}`, "", safeMarkdown(view.report), "");
  if (view.errors && view.errors.length > 0) {
    lines.push(`#### ${t.problems}`, "");
    for (const error of view.errors) lines.push(`- ${safeInline(error)}`);
    lines.push("");
  }
  lines.push(`**${t.nextStepLabel}:** ${t.nextStep(view.state)}`, "");
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
