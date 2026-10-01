import type { Messages } from "./i18n/index.ts";
import { oneLine, safeInline, safeMarkdown } from "./text.ts";

export interface PullRequestView {
  /** The task's language. */
  t: Messages;
  /** The line that closes the task's issue when the pull request merges. */
  closes: string;
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

/** The issue's title, so both carry the same words, in the language they were written in. */
export function pullRequestTitle(issueTitle: string): string {
  return oneLine(issueTitle).trim().slice(0, 256) || "Codeman task";
}

/** The pull request's description. Text from the agent is rendered as safe Markdown. */
export function pullRequestBody(view: PullRequestView): string {
  const { t } = view;
  const longest = Math.max(0, ...(view.commitMessage.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [
    view.closes,
    "",
    `### ${t.plan}`,
    "",
    safeInline(view.planSummary),
    "",
    `${t.fullPlan}: [${view.planPath}](${view.planUrl})`,
    "",
    `### ${t.changes}`,
    "",
    safeMarkdown(view.summary),
    "",
    ...(view.commitMessage
      ? [`### ${t.squashMessage}`, "", `${fence}text`, view.commitMessage, fence, ""]
      : []),
    pullRequestFooter(t, view.runUrl, view.spent),
  ].join("\n");
}

const FOOTER_MARKER = "<!-- codeman:footer -->";
/** The footer, in any language; older descriptions have it without the marker, in English. */
const FOOTER = /^(?:<!-- codeman:footer -->|<sub>Opened by Codeman\b).*$/m;

/** The description's last line, which Codeman updates on every run. */
export function pullRequestFooter(t: Messages, runUrl: string, spent?: string): string {
  return `${FOOTER_MARKER}${t.pullRequestFooter(spent, runUrl)}`;
}

/** Replaces the footer in a description; leaves the description alone if it has none. */
export function replaceFooter(body: string, footer: string): string {
  return FOOTER.test(body) ? body.replace(FOOTER, () => footer) : body;
}
