import type { Decision } from "./record.ts";
import { truncate } from "./text.ts";

/** What the agent reports after planning, in `.codeman/output.json`. */
export interface PlanOutput {
  summary: string;
  decisions: Decision[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const LIMITS = {
  summary: 2000,
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
  if (!Array.isArray(data.decisions) || data.decisions.length > LIMITS.decisions) {
    return { ok: false, error: `decisions must be a list of at most ${LIMITS.decisions}.` };
  }

  const decisions: Decision[] = [];
  for (const [index, item] of data.decisions.entries()) {
    const decision = parseDecision(item, index + 1);
    if (!decision.ok) return decision;
    decisions.push(decision.value);
  }
  return { ok: true, value: { summary: summary.value, decisions } };
}

/** What the agent reports after an implementation run, in `.codeman/output.json`. */
export interface ImplementOutput {
  status: "done" | "partial" | "blocked";
  summary: string;
  /** Message for this run's commit; when done, the suggested squash message too. */
  commitMessage: string;
  /** When blocked: what a human must do. */
  reason?: string;
}

const STATUSES: ReadonlySet<string> = new Set(["done", "partial", "blocked"]);

export function parseImplementOutput(text: string): Parsed<ImplementOutput> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "output.json is not valid JSON." };
  }
  if (!isObject(data)) return { ok: false, error: "output.json must be an object." };
  if (typeof data.status !== "string" || !STATUSES.has(data.status)) {
    return { ok: false, error: "status must be done, partial or blocked." };
  }
  const summary = string(data.summary, "summary", LIMITS.summary);
  if (!summary.ok) return summary;
  const message = string(data.commitMessage, "commitMessage", LIMITS.commitMessage);
  if (!message.ok) return message;
  const [subject = "", ...body] = message.value.split(/\r?\n/);
  const commitMessage = [truncate(subject.trim(), 72), ...body].join("\n").trim();

  const status = data.status as ImplementOutput["status"];
  if (status !== "blocked")
    return { ok: true, value: { status, summary: summary.value, commitMessage } };
  const reason = string(data.reason, "reason", LIMITS.summary);
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: { status, summary: summary.value, commitMessage, reason: reason.value },
  };
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
