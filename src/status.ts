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
  /** The agent's summary of its last run. Rendered as untrusted text. */
  report?: string | undefined;
  /** Problems with commands or the agent's output. Rendered as untrusted text. */
  errors?: readonly string[] | undefined;
}

const HEADINGS: Record<State | "new", string> = {
  new: "Waiting to start",
  planning: "Writing the plan",
  "awaiting-decision": "Waiting for your decisions",
  ready: "Ready to implement",
  "in-progress": "Implementing",
  "awaiting-workflow": "Waiting for a workflow",
  blocked: "Blocked",
  done: "Done",
};

/** The single comment Codeman keeps up to date on each task. */
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

  if (view.report) lines.push("#### Last run", "", inertLines(view.report), "");

  if (view.errors && view.errors.length > 0) {
    lines.push("#### Problems", "");
    for (const error of view.errors) lines.push(`- ${inlineText(error)}`);
    lines.push("");
  }

  lines.push(
    `<sub>Model: \`${view.model.replace(/`/g, "")}\` (change it with \`/codeman set model <id>\`) · [Last run](${view.runUrl})</sub>`,
  );
  return lines.join("\n");
}
