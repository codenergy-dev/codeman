import { gunzipSync, gzipSync } from "node:zlib";
import type { Command } from "./commands.ts";
import type { PodSpend } from "./inference/spend.ts";
import type { CommandError } from "./problems.ts";
import type { Spending } from "./spend.ts";
import type { Stage } from "./stages.ts";
import type { WebPage } from "./webdocs.ts";

export interface Option {
  key: string;
  label: string;
}

/** An answer is either one of the options or free text from `/codeman answer`. */
export interface Answer {
  option?: string;
  text?: string;
  by: string;
}

/** Comment and review IDs up to which a task's requests are handled. */
export interface Handled {
  commentId: number;
  reviewId: number;
}

/** The stages the routing agent chose to run next, and the ones it left out. */
export interface Route {
  /** The stages to run, in the order of stages, each with the router's brief for its agent. */
  stages: { stage: Stage; brief: string }[];
  /** The stages left out, each with the router's reason. */
  skipped: { stage: Stage; reason: string }[];
  /**
   * The requests the route answers: maintainer comments after `after` and up to `upTo`, and
   * reviews likewise. The router handled them, and its stages read them again.
   */
  requests?: { after: Handled; upTo: Handled } | undefined;
}

export interface Decision {
  id: number;
  title: string;
  question: string;
  options: Option[];
  recommendation: string;
  answer?: Answer;
}

/**
 * What Codeman knows about a task. Stored in its status comment on the issue. A new plan, first
 * or revised, keeps every field except its own and those in PLAN_RESETS: see `planRecord`.
 */
export interface TaskRecord {
  branch: string;
  planPath: string;
  summary: string;
  decisions: Decision[];
  /** Comments up to this ID have had their commands applied. */
  processedCommentId: number;
  /** Reviews on the pull request up to this ID have been handled. */
  processedReviewId?: number | undefined;
  /** The task's pull request, once opened. */
  pullRequest?: number | undefined;
  /** Implementation runs in a row that did not finish the task. */
  runs?: number | undefined;
  /** What the task has spent so far, in USD, as of its last run. */
  spent?: number | undefined;
  /** `/codeman accept-workflows` commands up to this comment ID have been handled. */
  acceptedCommentId?: number | undefined;
  /** Workflows (paths in the platform's workflow directory) whose runs the agent waits for. */
  awaiting?: string[] | undefined;
  /** The stage that works on the task next, or is working on it. */
  stage?: Stage | undefined;
  /**
   * The routing agent's choice, while its stages run; review always ends it. Without one, as in
   * records from before routing, stages follow their fixed order. An empty route is from before
   * review always ran, when the router could block the task.
   */
  route?: Route | undefined;
  /** What the last stage left for the next one: its report, or why it had nothing to do. */
  handoff?: { stage: Stage; text: string } | undefined;
  /** Times review sent the work back to code in a row. */
  reviewRounds?: number | undefined;
  /** Each stage's last summary, for the pull request's description. */
  reports?: Partial<Record<Stage, string>> | undefined;
  /** The suggested squash commit message, from the code stage. */
  commitMessage?: string | undefined;
  /** What each agent run spent, for the status comment's table. */
  spending?: Spending | undefined;
  /** The language of the task's conversation, as the planning agent reported it. */
  language?: string | undefined;
  /** The newest run comment on the issue. */
  reportCommentId?: number | undefined;
  /** The comment that shows the task's decisions. */
  decisionsCommentId?: number | undefined;
  /**
   * A stage that needs the runs of workflows still staged: the task goes on to review, and this
   * stage goes on with their results once they are accepted.
   */
  deferred?: { stage: Stage; workflows: string[] } | undefined;
  /** Review passed, and the task waits for its staged workflows to be accepted. */
  reviewed?: boolean | undefined;
  /**
   * The pages under `docs/web/` on the task branch, by path, with when each was last fetched,
   * for the panel to list old ones without reading every file again.
   */
  webPages?: Record<string, WebPage> | undefined;
  /** Workflows a maintainer accepted since the last stage run, for the next one to know. */
  accepted?: { by: string; workflows: string[] } | undefined;
  /** Self-hosted inference: the pods that served the task, whose billing makes up its spend. */
  inference?: { pods: PodSpend[] } | undefined;
}

/**
 * What a new plan starts over: its decisions get a comment of their own, after the run comments
 * before it, and work starts again at the first stage. Everything else is the task's history and
 * bookkeeping, such as the spend table and the handled accepts, and is kept. A plan without
 * decisions keeps the decisions comment, which then says there are none.
 */
export const PLAN_RESETS = [
  "decisionsCommentId",
  "reportCommentId",
  "stage",
  "route",
  "handoff",
  "reviewRounds",
  "awaiting",
  "deferred",
  "reviewed",
] as const satisfies readonly (keyof TaskRecord)[];

/** What a planning run writes into the record. */
export type PlanFields = Pick<
  TaskRecord,
  | "branch"
  | "planPath"
  | "summary"
  | "decisions"
  | "processedCommentId"
  | "processedReviewId"
  | "language"
>;

/** The record of a new plan: the previous record, if any, with the plan's fields and resets. */
export function planRecord(previous: TaskRecord | null | undefined, plan: PlanFields): TaskRecord {
  const record: TaskRecord = { ...previous, ...plan, runs: 0 };
  for (const field of PLAN_RESETS) {
    if (field !== "decisionsCommentId" || plan.decisions.length > 0) delete record[field];
  }
  return record;
}

/**
 * The number of a new plan's first decision: after every decision the task had, so a revised
 * plan's decisions never take the number of a settled one.
 */
export function nextDecisionId(record: TaskRecord | null | undefined): number {
  return Math.max(0, ...(record?.decisions ?? []).map((decision) => decision.id)) + 1;
}

export interface CommandSource {
  /** The comment the command came from; 0 for a pull request review. */
  commentId: number;
  author: string;
  command: Command;
}

export function pendingDecisions(record: TaskRecord): Decision[] {
  return record.decisions.filter((decision) => decision.answer === undefined);
}

/**
 * Applies decision commands in order. `model` and `replan` are read elsewhere and ignored here.
 * Returns the updated record and a message for each command that could not be applied.
 */
export function applyCommands(
  record: TaskRecord,
  sources: readonly CommandSource[],
): { record: TaskRecord; errors: CommandError[] } {
  const decisions = record.decisions.map((decision) => ({ ...decision }));
  const errors: CommandError[] = [];
  let processedCommentId = record.processedCommentId;

  for (const { commentId, author, command } of sources) {
    processedCommentId = Math.max(processedCommentId, commentId);
    if (command.kind === "invalid") {
      errors.push({ text: command.text, problem: command.problem });
    } else if (command.kind === "approve") {
      for (const decision of decisions) {
        decision.answer ??= { option: decision.recommendation, by: author };
      }
    } else if (command.kind === "decide") {
      for (const [id, option] of command.answers) {
        const decision = decisions.find((candidate) => candidate.id === id);
        if (!decision) {
          errors.push({ problem: { kind: "no-decision", id } });
        } else if (!decision.options.some((candidate) => candidate.key === option)) {
          errors.push({ problem: { kind: "no-option", id, option } });
        } else {
          decision.answer = { option, by: author };
        }
      }
    } else if (command.kind === "answer") {
      const decision = decisions.find((candidate) => candidate.id === command.id);
      if (decision) decision.answer = { text: command.text, by: author };
      else errors.push({ problem: { kind: "no-decision", id: command.id } });
    }
  }

  return { record: { ...record, decisions, processedCommentId }, errors };
}

const ANSWERS_START = "<!-- codeman:answers:start -->";
const ANSWERS_END = "<!-- codeman:answers:end -->";

/** Writes the recorded answers into the plan, replacing any previous answers block. */
export function writeAnswers(plan: string, record: TaskRecord): string {
  const answered = record.decisions.filter((decision) => decision.answer);
  if (answered.length === 0) return plan;
  const lines = answered.flatMap((decision) => {
    const head = `- Decision ${decision.id} (${oneLineTitle(decision.title)}):`;
    const answer = decision.answer;
    if (answer?.text !== undefined) {
      // Quoted under the list item; `<!--` is escaped so the text cannot end this block.
      const quoted = answer.text
        .split("\n")
        .map((line) => `  > ${line.replace(/<!--/g, "&lt;!--")}`);
      return [`${head} answered by ${answer.by}:`, "", ...quoted, ""];
    }
    const option = decision.options.find((candidate) => candidate.key === answer?.option);
    return [
      `${head} (${answer?.option}) ${oneLineTitle(option?.label ?? "")}, chosen by ${answer?.by}.`,
    ];
  });
  const block = [ANSWERS_START, ...lines, ANSWERS_END].join("\n");

  const start = plan.indexOf(ANSWERS_START);
  const end = plan.indexOf(ANSWERS_END);
  if (start !== -1 && end > start) {
    return plan.slice(0, start) + block + plan.slice(end + ANSWERS_END.length);
  }
  return `${plan.trimEnd()}\n\n## Answers\n\nRecorded by Codeman from \`/codeman\` commands on the issue.\n\n${block}\n`;
}

function oneLineTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const STATUS_MARKER = /<!-- codeman:status ([A-Za-z0-9_-]*) -->/;

/** The largest record Codeman decompresses. */
const MAX_RECORD_BYTES = 4 * 1024 * 1024;

/**
 * Hidden block that identifies the status comment and carries the task record. The record is
 * compressed: a comment holds at most 65,536 characters, and the record repeats what the
 * comment shows.
 */
export function encodeStatus(record: TaskRecord | undefined): string {
  const json = JSON.stringify({ version: 2, record: record ?? null });
  const data = gzipSync(json, { level: 9 }).toString("base64url");
  return `<!-- codeman:status ${data} -->`;
}

export function isStatusComment(body: string): boolean {
  return STATUS_MARKER.test(body);
}

/**
 * Reads the task record from a status comment. Callers must first check that the comment was
 * written by Codeman's own account, because anyone can post a comment with this marker.
 */
export function decodeStatus(body: string): TaskRecord | undefined {
  const data = STATUS_MARKER.exec(body)?.[1];
  if (!data) return undefined;
  try {
    const bytes = Buffer.from(data, "base64url");
    // Version 1 stored the JSON as it is; version 2 compresses it.
    const json =
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? gunzipSync(bytes, { maxOutputLength: MAX_RECORD_BYTES })
        : bytes;
    const parsed: unknown = JSON.parse(json.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("record" in parsed)) return undefined;
    const record = parsed.record as TaskRecord | null;
    return record ?? undefined;
  } catch {
    return undefined;
  }
}
