/** The subset of a GitHub issue (or pull request) that Codeman reads. */
export interface IssueLike {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
  labels: ReadonlyArray<string | { name?: string }>;
}

export interface Task {
  number: number;
  kind: "issue" | "pull_request";
  title: string;
  url: string;
  labels: string[];
}

export function toTask(issue: IssueLike): Task {
  return {
    number: issue.number,
    kind: issue.pull_request ? "pull_request" : "issue",
    title: issue.title,
    url: issue.html_url,
    labels: issue.labels
      .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
      .filter((name) => name !== ""),
  };
}

/**
 * Collapses untrusted text to a single line before logging it, so it cannot start a line
 * with a workflow command such as `::add-mask::`.
 */
export function oneLine(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ");
}
