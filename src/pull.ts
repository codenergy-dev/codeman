import { inertLines, inlineText } from "./text.ts";

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
  /** What the task has spent, such as `US$ 0.42 of US$ 2.00`. */
  spent?: string | undefined;
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
    inertLines(view.summary),
    "",
    "### Suggested squash commit message",
    "",
    `${fence}text`,
    view.commitMessage,
    fence,
    "",
    pullRequestFooter(view.runUrl, view.spent),
  ].join("\n");
}

const FOOTER = /^<sub>Opened by Codeman\b.*$/m;

/** The description's last line, which Codeman updates on every run. */
export function pullRequestFooter(runUrl: string, spent?: string): string {
  const cost = spent ? ` · Spent: ${spent}` : "";
  return `<sub>Opened by Codeman${cost} · [Last run](${runUrl})</sub>`;
}

/** Replaces the footer in a description; leaves the description alone if it has none. */
export function replaceFooter(body: string, footer: string): string {
  return FOOTER.test(body) ? body.replace(FOOTER, () => footer) : body;
}
