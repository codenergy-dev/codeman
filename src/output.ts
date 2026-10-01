import type { WorkflowConventions } from "./platform/conventions.ts";
import type { Decision } from "./record.ts";
import { isLanguageTag, type Settings } from "./settings.ts";
import type { Stage } from "./stages.ts";
import { truncate } from "./text.ts";

/** What the agent reports after planning, in `.codeman/output.json`. */
export interface PlanOutput {
  summary: string;
  decisions: Decision[];
  /** The conversation's language, as a BCP 47 tag, when the agent reported a valid one. */
  language?: string | undefined;
  /** Texts that were too long, and were cut. */
  cuts: Cut[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The limits the agent is told. Texts may be `MARGIN` times as long before they are cut. */
export interface OutputLimits {
  decisions: number;
  options: number;
  title: number;
  question: number;
  label: number;
  summary: number;
}

/**
 * How many times its limit a text may be before Codeman cuts it. The agent is not told: LLMs
 * count characters poorly, and a little over the limit is not worth losing a run.
 */
export const MARGIN = 2;
/** Characters of all decisions of one output together (titles, questions and labels). */
export const DECISIONS_TOTAL = 25_000;
/** Characters of a commit message. */
export const COMMIT_MESSAGE = 1000;

type LimitSettings = Pick<
  Settings,
  | "max-decisions"
  | "max-options"
  | "max-title-chars"
  | "max-question-chars"
  | "max-label-chars"
  | "max-summary-chars"
>;

export function outputLimits(settings: LimitSettings): OutputLimits {
  return {
    decisions: settings["max-decisions"],
    options: settings["max-options"],
    title: settings["max-title-chars"],
    question: settings["max-question-chars"],
    label: settings["max-label-chars"],
    summary: settings["max-summary-chars"],
  };
}

/** A text longer than `MARGIN` times its limit, cut to that length. */
export interface Cut {
  field: string;
  /** Its length as the agent wrote it. */
  length: number;
  /** The limit the agent was told. */
  limit: number;
}

/** A cut, as the agent reads it when asked to fix its output. */
export function cutText(cut: Cut): string {
  return `${cut.field} has ${cut.length} characters; the limit is ${cut.limit}.`;
}

/**
 * Validates the agent's output strictly: it is produced by an LLM that read untrusted text.
 * Only texts that are too long are accepted, cut.
 */
export function parsePlanOutput(text: string, limits: OutputLimits): Parsed<PlanOutput> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "output.json is not valid JSON." };
  }
  if (!isObject(data)) return { ok: false, error: "output.json must be an object." };

  const cuts: Cut[] = [];
  const summary = string(data.summary, "summary", limits.summary, cuts);
  if (!summary.ok) return summary;
  const decisions = parseDecisions(data.decisions, limits, cuts);
  if (!decisions.ok) return decisions;
  // Optional: without it, Codeman keeps talking in the language it used so far.
  const language =
    typeof data.language === "string" && isLanguageTag(data.language) ? data.language : undefined;
  return {
    ok: true,
    value: { summary: summary.value, decisions: decisions.value, language, cuts },
  };
}

/** What a stage's agent reports, in `.codeman/output.json`. */
export interface StageOutput {
  status: StageStatus;
  /** What the stage did, or why it had nothing to do. For review, the review report. */
  summary: string;
  /** Message for this run's commit, if it changed files; from code, the suggested squash message. */
  commitMessage?: string;
  /** What a human must do (blocked), what the workflows must produce, or what to change. */
  reason?: string;
  /** When awaiting a workflow: the workflow files, such as `.github/workflows/ios.yml` on GitHub. */
  workflows?: string[];
  /** When asking the maintainers: the decisions, numbered from 1. */
  decisions?: Decision[];
  /** Texts that were too long, and were cut. */
  cuts: Cut[];
}

export type StageStatus =
  | "done"
  | "skipped"
  | "partial"
  | "blocked"
  | "awaiting-workflow"
  | "decisions"
  | "changes";

/**
 * What Codeman would reject or cut in the agent's output, for the agent to fix while it still
 * runs. `stage` is undefined when planning. Empty when Codeman can use the output as it is.
 */
export function outputProblems(
  text: string | undefined,
  stage: Stage | undefined,
  limits: OutputLimits,
  workflows: WorkflowConventions,
): string[] {
  if (text === undefined) return ["output.json is missing."];
  const parsed =
    stage === undefined
      ? parsePlanOutput(text, limits)
      : parseStageOutput(text, stage, limits, workflows);
  if (!parsed.ok) return [parsed.error];
  return parsed.value.cuts.map(cutText);
}

/** What each stage may report. Review never leaves work half done; it judges. */
export const STAGE_STATUSES: Readonly<Record<Stage, readonly StageStatus[]>> = {
  design: ["done", "skipped", "partial", "blocked", "decisions"],
  code: ["done", "skipped", "partial", "blocked", "awaiting-workflow"],
  test: ["done", "skipped", "partial", "blocked", "awaiting-workflow"],
  review: ["done", "changes", "blocked", "decisions"],
};

/** Statuses that must say why. */
const NEEDS_REASON: ReadonlySet<StageStatus> = new Set([
  "skipped",
  "blocked",
  "awaiting-workflow",
  "changes",
]);
export function parseStageOutput(
  text: string,
  stage: Stage,
  limits: OutputLimits,
  workflows: WorkflowConventions,
): Parsed<StageOutput> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "output.json is not valid JSON." };
  }
  if (!isObject(data)) return { ok: false, error: "output.json must be an object." };
  const allowed = STAGE_STATUSES[stage];
  if (typeof data.status !== "string" || !(allowed as readonly string[]).includes(data.status)) {
    return {
      ok: false,
      error: `status must be one of ${allowed.join(", ")} in the ${stage} stage.`,
    };
  }
  const status = data.status as StageStatus;
  const cuts: Cut[] = [];
  const summary = string(data.summary, "summary", limits.summary, cuts);
  if (!summary.ok) return summary;
  const output: StageOutput = { status, summary: summary.value, cuts };

  if (data.commitMessage !== undefined) {
    const message = string(data.commitMessage, "commitMessage", COMMIT_MESSAGE, cuts);
    if (!message.ok) return message;
    const [subject = "", ...body] = message.value.split(/\r?\n/);
    output.commitMessage = [truncate(subject.trim(), 72), ...body].join("\n").trim();
  }
  if (NEEDS_REASON.has(status)) {
    const reason = string(data.reason, "reason", limits.summary, cuts);
    if (!reason.ok) return reason;
    output.reason = reason.value;
  }
  if (status === "awaiting-workflow") {
    const files = data.workflows;
    if (
      !Array.isArray(files) ||
      files.length === 0 ||
      files.length > 5 ||
      !files.every((path) => typeof path === "string" && workflows.file.test(path))
    ) {
      return {
        ok: false,
        error: `workflows must list 1 to 5 ${workflows.fileDescription}.`,
      };
    }
    output.workflows = [...new Set(files as string[])];
  }
  if (status === "decisions") {
    const decisions = parseDecisions(data.decisions, limits, cuts);
    if (!decisions.ok) return decisions;
    if (decisions.value.length === 0) return { ok: false, error: "decisions must not be empty." };
    output.decisions = decisions.value;
  }
  return { ok: true, value: output };
}

function parseDecisions(value: unknown, limits: OutputLimits, cuts: Cut[]): Parsed<Decision[]> {
  if (!Array.isArray(value) || value.length > limits.decisions) {
    return { ok: false, error: `decisions must be a list of at most ${limits.decisions}.` };
  }
  const decisions: Decision[] = [];
  for (const [index, item] of value.entries()) {
    const decision = parseDecision(item, index + 1, limits, cuts);
    if (!decision.ok) return decision;
    decisions.push(decision.value);
  }
  // Each text is bounded; together they must still fit in a comment.
  const total = decisions.reduce(
    (sum, decision) =>
      sum +
      decision.title.length +
      decision.question.length +
      decision.options.reduce((labels, option) => labels + option.label.length, 0),
    0,
  );
  if (total > DECISIONS_TOTAL * MARGIN) {
    return {
      ok: false,
      error: `decisions have ${total} characters in total; the limit is ${DECISIONS_TOTAL}.`,
    };
  }
  return { ok: true, value: decisions };
}

function parseDecision(
  item: unknown,
  id: number,
  limits: OutputLimits,
  cuts: Cut[],
): Parsed<Decision> {
  const where = `decisions[${id - 1}]`;
  if (!isObject(item)) return { ok: false, error: `${where} must be an object.` };
  if (item.id !== id) return { ok: false, error: `${where}.id must be ${id}.` };
  const title = string(item.title, `${where}.title`, limits.title, cuts);
  if (!title.ok) return title;
  const question = string(item.question, `${where}.question`, limits.question, cuts);
  if (!question.ok) return question;

  if (
    !Array.isArray(item.options) ||
    item.options.length < 2 ||
    item.options.length > limits.options
  ) {
    return { ok: false, error: `${where}.options must have 2 to ${limits.options} items.` };
  }
  const options = [];
  for (const [index, option] of item.options.entries()) {
    const key = String.fromCharCode(97 + index);
    if (!isObject(option) || option.key !== key) {
      return { ok: false, error: `${where}.options[${index}].key must be "${key}".` };
    }
    const label = string(option.label, `${where}.options[${index}].label`, limits.label, cuts);
    if (!label.ok) return label;
    options.push({ key, label: label.value });
  }

  if (!options.some((option) => option.key === item.recommendation)) {
    return { ok: false, error: `${where}.recommendation must be one of the option keys.` };
  }
  return {
    ok: true,
    value: {
      id,
      title: title.value,
      question: question.value,
      options,
      recommendation: item.recommendation as string,
    },
  };
}

/** A non-empty string, cut to `MARGIN` times its limit. */
function string(value: unknown, name: string, limit: number, cuts: Cut[]): Parsed<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${name} must be a non-empty string.` };
  }
  const text = value.trim();
  const max = limit * MARGIN;
  if (text.length <= max) return { ok: true, value: text };
  cuts.push({ field: name, length: text.length, limit });
  return { ok: true, value: truncate(text, max) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
