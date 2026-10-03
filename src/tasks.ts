import { type Command, parseCommands } from "./commands.ts";
import type {
  CiRun,
  Comment,
  Issue,
  Review,
  ReviewComment,
  ReviewVerdict,
} from "./platform/types.ts";
import type { CommandError } from "./problems.ts";
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

export interface Task {
  number: number;
  kind: Issue["kind"];
  title: string;
  body: string;
  url: string;
  labels: string[];
  /** Who opened the issue; undefined for a deleted account or a bot. */
  author: string | undefined;
}

export function toTask(issue: Issue): Task {
  return {
    number: issue.number,
    kind: issue.kind,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    labels: issue.labels,
    author: issue.author && !issue.author.bot ? issue.author.login : undefined,
  };
}

/**
 * Whether a maintainer opened the issue. The agent reads the issue's title and body as its task,
 * and whoever opened it can edit them at any time, so only maintainers' issues are tasks.
 */
export function openedByMaintainer(task: Task, maintainers: ReadonlySet<string>): boolean {
  return task.author !== undefined && maintainers.has(task.author);
}

export interface TaskComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

/**
 * The runs of the awaited workflows, if every one of them has run and finished. A workflow may
 * start more than one run for a commit (a rerun, for example); the latest counts.
 */
export function finishedRuns(
  runs: readonly CiRun[],
  awaited: readonly string[],
): CiRun[] | undefined {
  const latest = awaited.map(
    (path) => runs.filter((run) => run.path === path).sort((a, b) => b.id - a.id)[0],
  );
  if (latest.length === 0 || latest.some((run) => !run?.finished)) return undefined;
  return latest.flatMap((run) => (run ? [run] : []));
}

export interface TaskReview {
  id: number;
  author: string;
  verdict: ReviewVerdict;
  body: string;
  comments: { path: string; line: number | null; body: string }[];
}

/** Human commenters, whose permission on the repository decides whether their comments count. */
export function commenters(comments: readonly Pick<Comment, "author">[]): string[] {
  return [
    ...new Set(
      comments.flatMap((comment) =>
        comment.author && !comment.author.bot ? [comment.author.login] : [],
      ),
    ),
  ];
}

/**
 * Comments from maintainers: users with write access to the repository. Everything else is
 * ignored, including by the agent.
 */
export function authorizedComments(
  comments: readonly Comment[],
  maintainers: ReadonlySet<string>,
): TaskComment[] {
  return comments.flatMap((comment) =>
    comment.author && !comment.author.bot && maintainers.has(comment.author.login)
      ? [
          {
            id: comment.id,
            author: comment.author.login,
            body: comment.body,
            createdAt: comment.createdAt,
          },
        ]
      : [],
  );
}

/** Submitted reviews from maintainers, newer than `afterId`, with their line comments. */
export function authorizedReviews(
  reviews: readonly Review[],
  comments: readonly ReviewComment[],
  maintainers: ReadonlySet<string>,
  afterId: number,
): TaskReview[] {
  return reviews
    .filter(
      (review) =>
        review.id > afterId &&
        review.verdict !== "pending" &&
        review.author &&
        !review.author.bot &&
        maintainers.has(review.author.login),
    )
    .sort((a, b) => a.id - b.id)
    .map((review) => ({
      id: review.id,
      author: review.author?.login ?? "",
      verdict: review.verdict,
      body: review.body,
      comments: comments
        .filter((comment) => comment.reviewId === review.id)
        .map(({ path, line, body }) => ({ path, line, body })),
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
      review.verdict === "changes-requested" && !commands.some((command) => command.kind === "fix")
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

/**
 * Settings chosen for one task with `/codeman set` or `/codeman model`, in the issue's
 * description and then in comments: the last one wins.
 */
export function taskSettings(
  comments: readonly TaskComment[],
  description: readonly Command[] = [],
): PartialSettings {
  const settings: PartialSettings = {};
  const commands = [...description, ...commandsAfter(comments, 0).map(({ command }) => command)];
  for (const command of commands) {
    if (command.kind === "set") Object.assign(settings, { [command.name]: command.value });
  }
  return settings;
}

/** `route`: the routing agent chooses the stages that run next. */
export type Action = "plan" | "record" | "route" | "implement" | "accept";

/**
 * What made the router run: answered decisions (or a plan without any), a `fix` request, or
 * review asking for changes; `continue` after the router blocked the task.
 */
export type RouteTrigger = "decisions" | "fix" | "changes" | "continue";

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
  "routing",
  "researching",
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
        ((stageOfState(task.state) !== undefined || task.state === "routing") && !task.pending) ||
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
  /** Problems with the new commands, for the run comment. */
  problems: CommandError[];
  /** For `implement`: the stage this run works on. */
  stage?: Stage | undefined;
  /**
   * For `route`: what made the router run, and the first stage of the fixed order that runs
   * when its result cannot be used.
   */
  route?: { trigger: RouteTrigger; fallback: Stage } | undefined;
  /** For `accept`: the comment that accepted the staged workflows. */
  accept?: TaskComment | undefined;
  /** Finished runs of the workflows the agent waited for, whose results it gets. */
  workflowRuns?: CiRun[] | undefined;
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
  comments: readonly Comment[],
  bot: string,
  max = MAX_HISTORY,
): TaskComment[] {
  const runs = comments
    .filter((comment) => comment.author?.login === bot && isRunComment(comment.body))
    .sort((a, b) => b.id - a.id);
  const kept: TaskComment[] = [];
  let size = 0;
  for (const comment of runs) {
    const body = runCommentText(comment.body);
    size += body.length;
    if (size > max) break;
    kept.unshift({ id: comment.id, author: bot, body, createdAt: comment.createdAt });
  }
  return kept;
}

/**
 * Codeman's status comment. Only comments by the App count: anyone can post a comment that
 * contains the marker.
 */
export function findStatus(
  comments: readonly Comment[],
  bot: string,
): { id: number; record: TaskRecord | undefined; body: string } | undefined {
  const comment = comments.find(
    (candidate) => candidate.author?.login === bot && isStatusComment(candidate.body),
  );
  const body = comment?.body ?? "";
  return comment ? { id: comment.id, record: decodeStatus(body), body } : undefined;
}
