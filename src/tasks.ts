import { type Command, parseCommands } from "./commands.ts";
import { type CommandSource, decodeStatus, isStatusComment, type TaskRecord } from "./record.ts";
import type { State } from "./state.ts";

/** The subset of a GitHub issue (or pull request) that Codeman reads. */
export interface IssueLike {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  pull_request?: unknown;
  labels: ReadonlyArray<string | { name?: string }>;
}

export interface Task {
  number: number;
  kind: "issue" | "pull_request";
  title: string;
  body: string;
  url: string;
  labels: string[];
}

export function toTask(issue: IssueLike): Task {
  return {
    number: issue.number,
    kind: issue.pull_request ? "pull_request" : "issue",
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url,
    labels: issue.labels
      .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
      .filter((name) => name !== ""),
  };
}

/** The subset of a GitHub issue comment that Codeman reads. */
export interface CommentLike {
  id: number;
  body?: string | undefined;
  author_association: string;
  user: { login: string } | null;
  created_at: string;
}

export interface TaskComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

const AUTHORIZED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** Comments from maintainers. Everything else is ignored, including by the agent. */
export function authorizedComments(comments: readonly CommentLike[]): TaskComment[] {
  return comments.flatMap((comment) =>
    AUTHORIZED.has(comment.author_association) && comment.user
      ? [
          {
            id: comment.id,
            author: comment.user.login,
            body: comment.body ?? "",
            createdAt: comment.created_at,
          },
        ]
      : [],
  );
}

/** Commands from maintainer comments newer than `afterId`, in order. */
export function commandsAfter(comments: readonly TaskComment[], afterId: number): CommandSource[] {
  return comments
    .filter((comment) => comment.id > afterId)
    .sort((a, b) => a.id - b.id)
    .flatMap((comment) =>
      parseCommands(comment.body).map((command: Command) => ({
        commentId: comment.id,
        author: comment.author,
        command,
      })),
    );
}

/** The model for a task: the last valid `/codeman model` command, or the repository default. */
export function taskModel(comments: readonly TaskComment[], fallback: string): string {
  let model = fallback;
  for (const { command } of commandsAfter(comments, 0)) {
    if (command.kind === "model") model = command.model;
  }
  return model;
}

export type Action = "plan" | "record";

export interface Candidate {
  number: number;
  state: State | "new";
  /** For tasks awaiting a decision: whether maintainers posted commands not yet applied. */
  hasNewCommands?: boolean;
}

/**
 * Picks the one task this run works on. Recording answers needs no LLM, so it goes first;
 * then the oldest task that needs a plan. A task left in `planning` by an interrupted run is
 * planned again.
 */
export function chooseTask(
  candidates: readonly Candidate[],
): { number: number; action: Action } | undefined {
  const sorted = [...candidates].sort((a, b) => a.number - b.number);
  const record = sorted.find(
    (task) => task.state === "awaiting-decision" && task.hasNewCommands === true,
  );
  if (record) return { number: record.number, action: "record" };
  const plan = sorted.find((task) => task.state === "new" || task.state === "planning");
  if (plan) return { number: plan.number, action: "plan" };
  return undefined;
}

/** Everything the later jobs need about the selected task. Written by `select`, a trusted job. */
export interface TaskContext {
  version: 1;
  action: Action;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  /** Maintainer comments only. */
  comments: TaskComment[];
  fromState: State | "new";
  model: string;
  defaultBranch: string;
  branch: string;
  branchExists: boolean;
  baseSha: string;
  planPath: string;
  record: TaskRecord | null;
  statusCommentId: number | null;
  runUrl: string;
}

/**
 * Codeman's status comment. Only comments by the App count: anyone can post a comment that
 * contains the marker.
 */
export function findStatus(
  comments: readonly CommentLike[],
  bot: string,
): { id: number; record: TaskRecord | undefined } | undefined {
  const comment = comments.find(
    (candidate) => candidate.user?.login === bot && isStatusComment(candidate.body ?? ""),
  );
  return comment ? { id: comment.id, record: decodeStatus(comment.body ?? "") } : undefined;
}
