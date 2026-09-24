import { type Command, parseCommands } from "./commands.ts";
import {
  type CommandSource,
  type Decision,
  decodeStatus,
  isStatusComment,
  type TaskRecord,
} from "./record.ts";
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
  user: { login: string; type?: string } | null;
  created_at: string;
}

export interface TaskComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

/** Repository permissions that make a user a maintainer. `maintain` is reported as `write`. */
export const MAINTAINER_PERMISSIONS: ReadonlySet<string> = new Set(["admin", "write"]);

/** Human commenters, whose permission on the repository decides whether their comments count. */
export function commenters(comments: readonly CommentLike[]): string[] {
  return [
    ...new Set(
      comments.flatMap((comment) =>
        comment.user && comment.user.type !== "Bot" ? [comment.user.login] : [],
      ),
    ),
  ];
}

/**
 * Comments from maintainers: users with write access to the repository. Everything else is
 * ignored, including by the agent. (`author_association` is not used: GitHub computes it for
 * the reader, and an App token sees private organization members as contributors.)
 */
export function authorizedComments(
  comments: readonly CommentLike[],
  maintainers: ReadonlySet<string>,
): TaskComment[] {
  return comments.flatMap((comment) =>
    comment.user && comment.user.type !== "Bot" && maintainers.has(comment.user.login)
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
  /** Work asked for by commands not yet applied (tasks awaiting a decision or ready). */
  pending?: "record" | "replan" | undefined;
}

/** States in which maintainers can still answer decisions or ask for a new plan. */
export const DECIDING: ReadonlySet<State | "new"> = new Set(["awaiting-decision", "ready"]);

/** What the commands since the last processed comment ask for: a new plan wins over answers. */
export function pendingWork(sources: readonly CommandSource[]): Candidate["pending"] {
  if (sources.some(({ command }) => command.kind === "replan")) return "replan";
  return sources.length > 0 ? "record" : undefined;
}

/** Texts of the `/codeman replan` commands, in order. */
export function replanRequests(sources: readonly CommandSource[]): string[] {
  return sources.flatMap(({ command }) => (command.kind === "replan" ? [command.text] : []));
}

/**
 * Picks the one task this run works on. Recording answers needs no LLM, so it goes first;
 * then the oldest task that needs a plan: a new one, one left in `planning` by an interrupted
 * run, or one whose maintainers asked for a new plan.
 */
export function chooseTask(
  candidates: readonly Candidate[],
): { number: number; action: Action } | undefined {
  const sorted = [...candidates].sort((a, b) => a.number - b.number);
  const record = sorted.find((task) => task.pending === "record");
  if (record) return { number: record.number, action: "record" };
  const plan = sorted.find(
    (task) => task.state === "new" || task.state === "planning" || task.pending === "replan",
  );
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
  /** As stored in the status comment. New commands are applied only when their result is saved. */
  record: TaskRecord | null;
  /** Texts of the `/codeman replan` commands that sent the task back to planning. */
  replan: string[];
  /** Decisions answered so far, including answers given with the replan request. */
  settled: Decision[];
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
