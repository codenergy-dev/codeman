import { usd } from "./budget.ts";
import { encodeStatus, pendingDecisions, type TaskRecord } from "./record.ts";
import type { State } from "./state.ts";
import { inertLines, inlineText } from "./text.ts";

export interface StatusView {
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

const HEADINGS: Record<State | "new", string> = {
  new: "Waiting to start",
  planning: "Writing the plan",
  "awaiting-decision": "Waiting for your decisions",
  ready: "Ready to implement",
  designing: "Designing",
  coding: "Writing the code",
  testing: "Testing",
  reviewing: "Reviewing",
  "in-progress": "Implementing",
  "awaiting-workflow": "Waiting for a workflow",
  blocked: "Blocked",
  done: "Done",
};

/**
 * The task's panel: the single comment Codeman keeps up to date on each task, with where the
 * task is now. What each run did goes in a run comment of its own.
 */
export function renderStatus(view: StatusView): string {
  const { record } = view;
  const lines = [encodeStatus(record), `### Codeman: ${HEADINGS[view.state]}`, ""];

  if (view.message) lines.push(view.message, "");
  if (record && view.planUrl) lines.push(`Plan: [${record.planPath}](${view.planUrl})`, "");
  if (record?.pullRequest && view.pullRequestUrl) {
    lines.push(`Pull request: [#${record.pullRequest}](${view.pullRequestUrl})`, "");
  }
  if (record) lines.push(inlineText(record.summary), "");

  if (record && record.decisions.length > 0) {
    lines.push("#### Decisions", "");
    for (const decision of record.decisions) {
      lines.push(`**${decision.id}. ${inlineText(decision.title)}**`, "");
      lines.push(inlineText(decision.question), "");
      for (const option of decision.options) {
        const tags = [
          option.key === decision.recommendation ? "recommended" : "",
          option.key === decision.answer?.option ? `chosen by ${decision.answer.by}` : "",
        ].filter(Boolean);
        const suffix = tags.length > 0 ? ` _(${tags.join(", ")})_` : "";
        lines.push(`- **${option.key})** ${inlineText(option.label)}${suffix}`);
      }
      if (decision.answer?.text !== undefined) {
        lines.push("", `Answered by ${decision.answer.by}: ${inlineText(decision.answer.text)}`);
      }
      lines.push("");
    }
    if (view.state === "awaiting-decision" && pendingDecisions(record).length > 0) {
      lines.push(
        "Answer with `/codeman decide 1 a` (several at once: `/codeman decide 1 a 2 b`), or accept every recommendation with `/codeman approve`. To answer in your own words, use `/codeman answer 1 <text>`; to have the plan revised, use `/codeman replan <what to change>`. Only people with write access to the repository can answer.",
        "",
      );
    }
  }

  if (view.staged && view.staged.length > 0) {
    lines.push("#### Workflows to review", "");
    for (const path of view.staged) lines.push(`- ${inlineText(path)}`);
    lines.push(
      "",
      "The agent wrote these workflows. They are staged under `.codeman/workflows/` on the task branch and do not run. A workflow runs with the repository's secrets, so read them in the pull request or on the branch first. To move them into `.github/workflows/`, comment `/codeman accept-workflows`.",
      "",
    );
  }

  const spent =
    view.cost?.task === undefined ? "" : ` · ${spentText({ ...view.cost, run: undefined })}`;
  const report = view.reportUrl ? ` · [Last report](${view.reportUrl})` : "";
  lines.push(
    `<sub>Model: \`${modelName(view.model)}\` (change it with \`/codeman set model <id>\`)${spent} · [Last run](${view.runUrl})${report}</sub>`,
  );
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
}

/** What one run did, posted as a new comment so the issue keeps the task's history. */
export function renderRun(view: RunView): string {
  const lines = [RUN_MARKER, `### Codeman: ${view.title}`, "", `Now: ${HEADINGS[view.state]}.`, ""];
  if (view.message) lines.push(view.message, "");
  if (view.report) lines.push("#### Report", "", inertLines(view.report), "");
  if (view.errors && view.errors.length > 0) {
    lines.push("#### Problems", "");
    for (const error of view.errors) lines.push(`- ${inlineText(error)}`);
    lines.push("");
  }
  const spent = view.cost?.task === undefined ? "" : ` · ${spentText(view.cost)}`;
  lines.push(`<sub>Model: \`${modelName(view.model)}\`${spent} · [Run](${view.runUrl})</sub>`);
  return lines.join("\n");
}

function spentText(cost: Cost): string {
  const run = cost.run === undefined ? "" : `${usd(cost.run)} this run, `;
  return `Spent: ${run}${usd(cost.task ?? 0)} of ${usd(cost.budget)} for the task`;
}

function modelName(model: string): string {
  return model.replace(/`/g, "");
}
