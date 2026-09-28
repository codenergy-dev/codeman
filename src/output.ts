import type { Decision } from "./record.ts";
import { isLanguageTag } from "./settings.ts";
import type { Stage } from "./stages.ts";
import { truncate } from "./text.ts";

/** What the agent reports after planning, in `.codeman/output.json`. */
export interface PlanOutput {
  summary: string;
  decisions: Decision[];
  /** The conversation's language, as a BCP 47 tag, when the agent reported a valid one. */
  language?: string | undefined;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const LIMITS = {
  summary: 4000,
  decisions: 10,
  title: 200,
  question: 1000,
  label: 300,
  options: 6,
  commitMessage: 2000,
};

/** Validates the agent's output strictly: it is produced by an LLM that read untrusted text. */
export function parsePlanOutput(text: string): Parsed<PlanOutput> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "output.json is not valid JSON." };
  }
  if (!isObject(data)) return { ok: false, error: "output.json must be an object." };

  const summary = string(data.summary, "summary", LIMITS.summary);
  if (!summary.ok) return summary;
  const decisions = parseDecisions(data.decisions);
  if (!decisions.ok) return decisions;
  // Optional: without it, Codeman keeps talking in the language it used so far.
  const language =
    typeof data.language === "string" && isLanguageTag(data.language) ? data.language : undefined;
  return { ok: true, value: { summary: summary.value, decisions: decisions.value, language } };
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
  /** When awaiting a workflow: the workflow files, such as `.github/workflows/ios.yml`. */
  workflows?: string[];
  /** When asking the maintainers: the decisions, numbered from 1. */
  decisions?: Decision[];
}

export type StageStatus =
  | "done"
  | "skipped"
  | "partial"
  | "blocked"
  | "awaiting-workflow"
  | "decisions"
  | "changes";

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
const WORKFLOW_FILE = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;

export function parseStageOutput(text: string, stage: Stage): Parsed<StageOutput> {
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
  const summary = string(data.summary, "summary", LIMITS.summary);
  if (!summary.ok) return summary;
  const output: StageOutput = { status, summary: summary.value };

  if (data.commitMessage !== undefined) {
    const message = string(data.commitMessage, "commitMessage", LIMITS.commitMessage);
    if (!message.ok) return message;
    const [subject = "", ...body] = message.value.split(/\r?\n/);
    output.commitMessage = [truncate(subject.trim(), 72), ...body].join("\n").trim();
  }
  if (NEEDS_REASON.has(status)) {
    const reason = string(data.reason, "reason", LIMITS.summary);
    if (!reason.ok) return reason;
    output.reason = reason.value;
  }
  if (status === "awaiting-workflow") {
    const workflows = data.workflows;
    if (
      !Array.isArray(workflows) ||
      workflows.length === 0 ||
      workflows.length > 5 ||
      !workflows.every((path) => typeof path === "string" && WORKFLOW_FILE.test(path))
    ) {
      return {
        ok: false,
        error: "workflows must list 1 to 5 files directly under .github/workflows/.",
      };
    }
    output.workflows = [...new Set(workflows as string[])];
  }
  if (status === "decisions") {
    const decisions = parseDecisions(data.decisions);
    if (!decisions.ok) return decisions;
    if (decisions.value.length === 0) return { ok: false, error: "decisions must not be empty." };
    output.decisions = decisions.value;
  }
  return { ok: true, value: output };
}

function parseDecisions(value: unknown): Parsed<Decision[]> {
  if (!Array.isArray(value) || value.length > LIMITS.decisions) {
    return { ok: false, error: `decisions must be a list of at most ${LIMITS.decisions}.` };
  }
  const decisions: Decision[] = [];
  for (const [index, item] of value.entries()) {
    const decision = parseDecision(item, index + 1);
    if (!decision.ok) return decision;
    decisions.push(decision.value);
  }
  return { ok: true, value: decisions };
}

function parseDecision(item: unknown, id: number): Parsed<Decision> {
  const where = `decisions[${id - 1}]`;
  if (!isObject(item)) return { ok: false, error: `${where} must be an object.` };
  if (item.id !== id) return { ok: false, error: `${where}.id must be ${id}.` };
  const title = string(item.title, `${where}.title`, LIMITS.title);
  if (!title.ok) return title;
  const question = string(item.question, `${where}.question`, LIMITS.question);
  if (!question.ok) return question;

  if (
    !Array.isArray(item.options) ||
    item.options.length < 2 ||
    item.options.length > LIMITS.options
  ) {
    return { ok: false, error: `${where}.options must have 2 to ${LIMITS.options} items.` };
  }
  const options = [];
  for (const [index, option] of item.options.entries()) {
    const key = String.fromCharCode(97 + index);
    if (!isObject(option) || option.key !== key) {
      return { ok: false, error: `${where}.options[${index}].key must be "${key}".` };
    }
    const label = string(option.label, `${where}.options[${index}].label`, LIMITS.label);
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

function string(value: unknown, name: string, max: number): Parsed<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${name} must be a non-empty string.` };
  }
  if (value.length > max) return { ok: false, error: `${name} must be at most ${max} characters.` };
  return { ok: true, value: value.trim() };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
