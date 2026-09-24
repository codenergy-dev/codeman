import { encodeStatus, pendingDecisions, type TaskRecord } from "./record.ts";
import type { State } from "./state.ts";
import { inlineText } from "./text.ts";

export interface StatusView {
  state: State | "new";
  record?: TaskRecord | undefined;
  model: string;
  runUrl: string;
  planUrl?: string | undefined;
  /** A note from Codeman itself (trusted text). */
  message?: string | undefined;
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
      lines.push("");
    }
    if (view.state === "awaiting-decision" && pendingDecisions(record).length > 0) {
      lines.push(
        "Answer with `/codeman decide 1=a 2=b`, or accept every recommendation with `/codeman approve`. Only owners, members and collaborators can answer.",
        "",
      );
    }
  }

  if (view.errors && view.errors.length > 0) {
    lines.push("#### Problems", "");
    for (const error of view.errors) lines.push(`- ${inlineText(error)}`);
    lines.push("");
  }

  lines.push(
    `<sub>Model: \`${view.model.replace(/`/g, "")}\` (change it with \`/codeman model <id>\`) · [Last run](${view.runUrl})</sub>`,
  );
  return lines.join("\n");
}
