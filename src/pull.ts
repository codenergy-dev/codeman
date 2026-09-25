import { inlineText } from "./text.ts";

export interface PullRequestView {
  issue: number;
  planPath: string;
  planUrl: string;
  /** The plan's summary, from the task record. */
  planSummary: string;
  /** The agent's summary of the work. */
  summary: string;
  commitMessage: string;
  runUrl: string;
}

export function pullRequestTitle(commitMessage: string): string {
  return commitMessage.split("\n")[0]?.trim() || "Codeman task";
}

/** The pull request's description. Text from the agent is rendered inert. */
export function pullRequestBody(view: PullRequestView): string {
  const longest = Math.max(0, ...(view.commitMessage.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [
    `Closes #${view.issue}`,
    "",
    "### Plan",
    "",
    inlineText(view.planSummary),
    "",
    `Full plan: [${view.planPath}](${view.planUrl})`,
    "",
    "### Changes",
    "",
    lines(view.summary),
    "",
    "### Suggested squash commit message",
    "",
    `${fence}text`,
    view.commitMessage,
    fence,
    "",
    `<sub>Opened by Codeman · [Last run](${view.runUrl})</sub>`,
  ].join("\n");
}

/** Inert Markdown that keeps the text's line breaks. */
function lines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => inlineText(line))
    .join("\n");
}
