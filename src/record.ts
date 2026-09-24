import type { Command } from "./commands.ts";

export interface Option {
  key: string;
  label: string;
}

export interface Answer {
  option: string;
  by: string;
}

export interface Decision {
  id: number;
  title: string;
  question: string;
  options: Option[];
  recommendation: string;
  answer?: Answer;
}

/** What Codeman knows about a task. Stored in its status comment on the issue. */
export interface TaskRecord {
  branch: string;
  planPath: string;
  summary: string;
  decisions: Decision[];
  /** Comments up to this ID have had their commands applied. */
  processedCommentId: number;
}

export interface CommandSource {
  commentId: number;
  author: string;
  command: Command;
}

export function pendingDecisions(record: TaskRecord): Decision[] {
  return record.decisions.filter((decision) => decision.answer === undefined);
}

/**
 * Applies decision commands in order. Model commands are read elsewhere and ignored here.
 * Returns the updated record and a message for each command that could not be applied.
 */
export function applyCommands(
  record: TaskRecord,
  sources: readonly CommandSource[],
): { record: TaskRecord; errors: string[] } {
  const decisions = record.decisions.map((decision) => ({ ...decision }));
  const errors: string[] = [];
  let processedCommentId = record.processedCommentId;

  for (const { commentId, author, command } of sources) {
    processedCommentId = Math.max(processedCommentId, commentId);
    if (command.kind === "invalid") {
      errors.push(`${command.text}: ${command.reason}`);
    } else if (command.kind === "approve") {
      for (const decision of decisions) {
        decision.answer ??= { option: decision.recommendation, by: author };
      }
    } else if (command.kind === "decide") {
      for (const [id, option] of command.answers) {
        const decision = decisions.find((candidate) => candidate.id === id);
        if (!decision) {
          errors.push(`Decision ${id} does not exist.`);
        } else if (!decision.options.some((candidate) => candidate.key === option)) {
          errors.push(`Decision ${id} has no option \`${option}\`.`);
        } else {
          decision.answer = { option, by: author };
        }
      }
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
  const lines = answered.map((decision) => {
    const option = decision.options.find((candidate) => candidate.key === decision.answer?.option);
    return `- Decision ${decision.id} (${oneLineTitle(decision.title)}): (${decision.answer?.option}) ${oneLineTitle(option?.label ?? "")}, chosen by ${decision.answer?.by}.`;
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

/** Hidden block that identifies the status comment and carries the task record. */
export function encodeStatus(record: TaskRecord | undefined): string {
  const data = Buffer.from(JSON.stringify({ version: 1, record: record ?? null })).toString(
    "base64url",
  );
  return `<!-- codeman:status ${data} -->`;
}

export function isStatusComment(body: string): boolean {
  return STATUS_MARKER.test(body);
}

/**
 * Reads the task record from a status comment. Callers must first check that the comment was
 * written by Codeman's GitHub App, because anyone can post a comment with this marker.
 */
export function decodeStatus(body: string): TaskRecord | undefined {
  const data = STATUS_MARKER.exec(body)?.[1];
  if (!data) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("record" in parsed)) return undefined;
    const record = parsed.record as TaskRecord | null;
    return record ?? undefined;
  } catch {
    return undefined;
  }
}
