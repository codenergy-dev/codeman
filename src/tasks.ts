import { type Command, parseCommands } from "./commands.ts";
import {
  type CommandSource,
  type Decision,
  decodeStatus,
  isStatusComment,
  type TaskRecord,
} from "./record.ts";
import type { PartialSettings, Settings } from "./settings.ts";
import { type Stage, stageOfState } from "./stages.ts";
import type { State } from "./state.ts";
import { isRunComment, runCommentText } from "./status.ts";

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

/** A finished run of a workflow the agent asked for. */
export interface WorkflowRun {
  id: number;
  name: string;
  path: string;
  conclusion: string | null;
  url: string;
}

/** The subset of a GitHub Actions run that Codeman reads. */
export interface WorkflowRunLike {
  id: number;
  name?: string | null;
  path: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
}

/**
 * The runs of the awaited workflows, if every one of them has run and finished. A workflow may
 * start more than one run for a commit (a rerun, for example); the latest counts.
 */
export function finishedRuns(
  runs: readonly WorkflowRunLike[],
  awaited: readonly string[],
): WorkflowRun[] | undefined {
  const latest = awaited.map(
    (path) => runs.filter((run) => run.path === path).sort((a, b) => b.id - a.id)[0],
  );
  if (latest.length === 0 || latest.some((run) => run?.status !== "completed")) {
    return undefined;
  }
  return latest.flatMap((run) =>
    run
      ? [
          {
            id: run.id,
            name: run.name ?? run.path,
            path: run.path,
            conclusion: run.conclusion,
            url: run.html_url,
          },
        ]
      : [],
  );
}

/** The subset of a pull request review that Codeman reads. */
export interface ReviewLike {
  id: number;
  body?: string | null;
  state: string;
  user: { login: string; type?: string } | null;
}

/** The subset of a pull request review comment (on a line of the diff) that Codeman reads. */
export interface ReviewCommentLike {
  pull_request_review_id: number | null;
  path: string;
  line?: number | null;
  original_line?: number | null;
  body: string;
}

export interface TaskReview {
  id: number;
  author: string;
  /** GitHub's review state, such as `CHANGES_REQUESTED` or `COMMENTED`. */
  state: string;
  body: string;
  comments: { path: string; line: number | null; body: string }[];
}

/** Repository permissions that make a user a maintainer. `maintain` is reported as `write`. */
export const MAINTAINER_PERMISSIONS: ReadonlySet<string> = new Set(["admin", "write"]);

/** Human commenters, whose permission on the repository decides whether their comments count. */
export function commenters(
  comments: readonly { user: { login: string; type?: string } | null }[],
): string[] {
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

/** Submitted reviews from maintainers, newer than `afterId`, with their line comments. */
export function authorizedReviews(
  reviews: readonly ReviewLike[],
  comments: readonly ReviewCommentLike[],
  maintainers: ReadonlySet<string>,
  afterId: number,
): TaskReview[] {
  return reviews
    .filter(
      (review) =>
        review.id > afterId &&
        review.state !== "PENDING" &&
        review.user &&
        review.user.type !== "Bot" &&
        maintainers.has(review.user.login),
    )
    .sort((a, b) => a.id - b.id)
    .map((review) => ({
      id: review.id,
      author: review.user?.login ?? "",
      state: review.state,
      body: review.body ?? "",
      comments: comments
        .filter((comment) => comment.pull_request_review_id === review.id)
        .map((comment) => ({
          path: comment.path,
          line: comment.line ?? comment.original_line ?? null,
          body: comment.body,
        })),
    }));
}

/**
 * Commands in review bodies. A review that requests changes without a `fix` command counts as
 * one, with the review's text.
 */
export function reviewCommands(reviews: readonly TaskReview[]): CommandSource[] {
  return reviews.flatMap((review) => {
    const commands = parseCommands(review.body);
    const implicit: Command[] =
      review.state === "CHANGES_REQUESTED" && !commands.some((command) => command.kind === "fix")
        ? [{ kind: "fix", text: review.body.trim() }]
        : [];
    return [...commands, ...implicit].map((command) => ({
      commentId: 0,
      author: review.author,
      command,
    }));
  });
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

/** Settings chosen for one task with `/codeman set` or `/codeman model`: the last one wins. */
export function taskSettings(comments: readonly TaskComment[]): PartialSettings {
  const settings: PartialSettings = {};
  for (const { command } of commandsAfter(comments, 0)) {
    if (command.kind === "set") Object.assign(settings, { [command.name]: command.value });
  }
  return settings;
}

export type Action = "plan" | "record" | "implement" | "accept";

export interface Candidate {
  number: number;
  state: State | "new";
  /** Work asked for by commands not yet handled. */
  pending?: Pending | undefined;
  /** Whether the task has a plan with every decision answered. */
  planned?: boolean | undefined;
  /** A maintainer accepted the staged workflows, and that is not handled yet. */
  accept?: boolean | undefined;
  /** Every run of the workflows the agent waits for has finished. */
  workflowsDone?: boolean | undefined;
}

/**
 * `record`: apply answers. `replan`: write the plan again. `resume`: go on after a `fix` or
 * `continue` request, with a fresh run count.
 */
export type Pending = "record" | "replan" | "resume";

/** States in which maintainers can still answer decisions. */
export const DECIDING: ReadonlySet<State | "new"> = new Set(["awaiting-decision", "ready"]);

/** States in which `fix` and `continue` resume the work. */
export const RESUMABLE: ReadonlySet<State | "new"> = new Set([
  "ready",
  "designing",
  "coding",
  "testing",
  "reviewing",
  "in-progress",
  "awaiting-workflow",
  "blocked",
  "done",
]);

/** The last `/codeman accept-workflows` in a maintainer comment after `afterId`, if any. */
export function acceptRequest(
  comments: readonly TaskComment[],
  afterId: number,
): TaskComment | undefined {
  return comments
    .filter(
      (comment) =>
        comment.id > afterId &&
        parseCommands(comment.body).some((command) => command.kind === "accept-workflows"),
    )
    .sort((a, b) => a.id - b.id)
    .at(-1);
}

/**
 * What the commands since the last handled comment and review ask for, in the task's state.
 * A new plan wins, then resuming, then answers. Anything else waits for its state.
 */
export function pendingWork(
  sources: readonly CommandSource[],
  state: State | "new",
): Pending | undefined {
  const kinds = new Set(sources.map(({ command }) => command.kind));
  if (kinds.has("replan")) return "replan";
  if (RESUMABLE.has(state) && (kinds.has("fix") || kinds.has("continue"))) return "resume";
  if (DECIDING.has(state) && sources.length > 0) return "record";
  return undefined;
}

/** Texts of `fix` and `continue` requests, in order. */
export function resumeRequests(sources: readonly CommandSource[]): Request[] {
  return sources.flatMap(({ author, command }) =>
    command.kind === "fix" || command.kind === "continue"
      ? [{ kind: command.kind, author, text: command.text }]
      : [],
  );
}

export interface Request {
  kind: "fix" | "continue";
  author: string;
  text: string;
}

/** Texts of the `/codeman replan` commands, in order. */
export function replanRequests(sources: readonly CommandSource[]): string[] {
  return sources.flatMap(({ command }) => (command.kind === "replan" ? [command.text] : []));
}

/**
 * Picks the one task this run works on. Accepting workflows and recording answers need no LLM,
 * so they go first;
 * then the oldest task that needs a plan: a new one, one left in `planning` by an interrupted
 * run, or one whose maintainers asked for a new plan; then the oldest task to implement:
 * resumed or in progress before ready. A resumed task without a finished plan plans again.
 */
export function chooseTask(
  candidates: readonly Candidate[],
): { number: number; action: Action } | undefined {
  const sorted = [...candidates].sort((a, b) => a.number - b.number);
  const accept = sorted.find((task) => task.accept);
  if (accept) return { number: accept.number, action: "accept" };
  const record = sorted.find((task) => task.pending === "record");
  if (record) return { number: record.number, action: "record" };
  const plan = sorted.find(
    (task) =>
      task.state === "new" ||
      task.state === "planning" ||
      task.pending === "replan" ||
      (task.pending === "resume" && !task.planned),
  );
  if (plan) return { number: plan.number, action: "plan" };
  const implement =
    sorted.find(
      (task) =>
        (task.pending === "resume" && task.planned) ||
        (stageOfState(task.state) !== undefined && !task.pending) ||
        (task.state === "awaiting-workflow" && task.workflowsDone && !task.pending),
    ) ?? sorted.find((task) => task.state === "ready" && !task.pending);
  if (implement) return { number: implement.number, action: "implement" };
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
  /** Maintainer comments only, on the issue and on its pull request. */
  comments: TaskComment[];
  /** Maintainer reviews on the pull request since the last run that handled reviews. */
  reviews: TaskReview[];
  /** `fix` and `continue` requests that resume the work, with a fresh run count. */
  requests: Request[];
  /** Whether this run resumes the work after a `fix` or `continue` request. */
  resume: boolean;
  /** Everything up to these IDs is handled once this run ends, unless it could not start. */
  processed: { commentId: number; reviewId: number };
  /** Problems with the new commands, for the status comment. */
  problems: string[];
  /** For `implement`: the stage this run works on. */
  stage?: Stage | undefined;
  /** For `accept`: the comment that accepted the staged workflows. */
  accept?: TaskComment | undefined;
  /** Finished runs of the workflows the agent waited for, whose results it gets. */
  workflowRuns?: WorkflowRun[] | undefined;
  /** For `implement`: Codeman's earlier run comments on the task, oldest first. */
  history?: TaskComment[] | undefined;
  fromState: State | "new";
  model: string;
  settings: Settings;
  /** The repository's `.codemanignore`, read from the default branch; null when it has none. */
  ignore: string | null;
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

/** How much of the task's history the agent reads, in characters. */
export const MAX_HISTORY = 20_000;

/**
 * Codeman's run comments on the task, oldest first: the newest ones that fit in `max`
 * characters. Only comments by the App count, as with the status comment.
 */
export function runHistory(
  comments: readonly CommentLike[],
  bot: string,
  max = MAX_HISTORY,
): TaskComment[] {
  const runs = comments
    .filter((comment) => comment.user?.login === bot && isRunComment(comment.body ?? ""))
    .sort((a, b) => b.id - a.id);
  const kept: TaskComment[] = [];
  let size = 0;
  for (const comment of runs) {
    const body = runCommentText(comment.body ?? "");
    size += body.length;
    if (size > max) break;
    kept.unshift({ id: comment.id, author: bot, body, createdAt: comment.created_at });
  }
  return kept;
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
