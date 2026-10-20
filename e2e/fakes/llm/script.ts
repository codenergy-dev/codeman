import { STAGES, type Stage } from "../../../src/stages.ts";
import { HttpError } from "../http.ts";

/**
 * The scripts of the scripted model: a scenario's `agent:` section. Per issue ref, per stage,
 * a list of rounds (each run of that stage, in order), and per round the steps the model turns
 * into OpenCode tool calls, one model turn each, then a final answer that ends OpenCode's loop.
 *
 * ```yaml
 * i1:
 *   plan:
 *     - steps:
 *         - output: { summary: Adds a route., language: en, decisions: [] }
 *   code:
 *     - usage: { prompt: 1200, completion: 300 }
 *       steps:
 *         - write: { path: src/health.ts, content: "export const ok = true;\n" }
 *         - bash: npm test
 *         - output: { status: done, summary: Adds the route., commitMessage: Add a health route }
 *       fix:
 *         - output: { status: done, summary: Shorter. }
 * ```
 */

/** Tokens a reply reports, for deterministic costs. */
export interface Usage {
  prompt: number;
  completion: number;
  /** Prompt tokens read from cache, part of `prompt`. */
  cached?: number;
}

/** One model turn: a tool call, a reply that never ends, or one that breaks off. */
export type Action =
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; old: string; new: string; all?: boolean }
  | { kind: "bash"; command: string; timeout?: number; workdir?: string }
  | { kind: "read"; path: string; offset?: number; limit?: number }
  /** `.codeman/output.json`, written as JSON: the stage's output, in the shape Codeman parses. */
  | { kind: "output"; value: unknown }
  /** `.codeman/output.json`, written as this text: an invalid output. */
  | { kind: "raw"; text: string }
  /** The reply starts, then never ends. */
  | { kind: "hang" }
  /** The reply starts, then the connection drops. */
  | { kind: "exit" };

/** A turn, with what `delay` and `usage` steps before it set. */
export interface Turn {
  action: Action;
  delayMs: number;
  usage: Usage | undefined;
}

export interface Round {
  steps: Turn[];
  /** The turns of the fix pass, when Codeman resumes the session with its output's problems. */
  fix: Turn[] | undefined;
  /** What each reply of the round reports, unless a `usage` step says otherwise. */
  usage: Usage | undefined;
  /** The final answer's text, after the last step: `Done.` by default. */
  final: string;
  /** `delay` and `usage` steps after the last step: they apply to the final answer. */
  finalDelayMs: number;
  finalUsage: Usage | undefined;
  fixFinalDelayMs: number;
  fixFinalUsage: Usage | undefined;
}

/** A scenario's script: rounds by issue ref and stage. */
export type Script = Record<string, Partial<Record<Stage, Round[]>>>;

/** What a scenario's or an issue's name may hold: it goes in the marker and in URLs. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The marker the e2e runtime puts in an issue's body, which reaches the agent through the task
 * file, so the model knows which scenario and issue a conversation belongs to.
 */
export function marker(scenario: string, issue: string): string {
  if (!NAME.test(scenario)) throw new Error(`"${scenario}" is not a scenario name.`);
  if (!REF.test(issue)) throw new Error(`"${issue}" is not an issue ref.`);
  return `<!-- codeman-e2e scenario=${scenario} issue=${issue} -->`;
}

/** The marker's fields, as `marker` writes them. */
export const MARKER =
  /<!-- codeman-e2e scenario=([A-Za-z0-9][A-Za-z0-9._/-]*) issue=([A-Za-z0-9][A-Za-z0-9._-]*) -->/;

export function isScenarioName(name: string): boolean {
  return NAME.test(name);
}

/** A script from the control API's or a file's JSON; a 400 that names the bad field otherwise. */
export function scriptOf(value: unknown): Script {
  const script: Script = {};
  for (const [issue, stages] of entries(value, "$")) {
    if (!REF.test(issue)) fail(`$.${issue}`, "an issue ref: letters, digits, '.', '_' and '-'");
    const byStage: Partial<Record<Stage, Round[]>> = {};
    for (const [stage, rounds] of entries(stages, `$.${issue}`)) {
      const path = `$.${issue}.${stage}`;
      if (!(STAGES as readonly string[]).includes(stage)) {
        fail(path, `a stage: ${STAGES.join(", ")}`);
      }
      if (!Array.isArray(rounds)) fail(path, "a list of rounds");
      byStage[stage as Stage] = rounds.map((round, index) => roundOf(round, `${path}[${index}]`));
    }
    script[issue] = byStage;
  }
  return script;
}

function roundOf(value: unknown, path: string): Round {
  const fields = record(value, path);
  for (const name of Object.keys(fields)) {
    if (!["steps", "fix", "usage", "final"].includes(name)) {
      fail(`${path}.${name}`, "absent: a round has steps, and may have fix, usage and final");
    }
  }
  if (!Array.isArray(fields.steps)) fail(`${path}.steps`, "a list of steps");
  if (fields.fix !== undefined && !Array.isArray(fields.fix))
    fail(`${path}.fix`, "a list of steps");
  if (fields.final !== undefined && typeof fields.final !== "string") {
    fail(`${path}.final`, "a string");
  }
  const steps = turnsOf(fields.steps, `${path}.steps`);
  const fix = fields.fix === undefined ? undefined : turnsOf(fields.fix, `${path}.fix`);
  return {
    steps: steps.turns,
    fix: fix?.turns,
    usage: fields.usage === undefined ? undefined : usageOf(fields.usage, `${path}.usage`),
    final: (fields.final as string | undefined) ?? "Done.",
    finalDelayMs: steps.delayMs,
    finalUsage: steps.usage,
    fixFinalDelayMs: fix?.delayMs ?? 0,
    fixFinalUsage: fix?.usage,
  };
}

/** Steps as turns: `delay` and `usage` steps apply to the turn after them, and are none. */
function turnsOf(
  steps: unknown[],
  path: string,
): { turns: Turn[]; delayMs: number; usage: Usage | undefined } {
  const turns: Turn[] = [];
  let delayMs = 0;
  let usage: Usage | undefined;
  steps.forEach((step, index) => {
    const at = `${path}[${index}]`;
    const [kind, body] = stepKind(step, at);
    if (kind === "delay") {
      const ms = typeof body === "object" && body !== null ? (body as { ms?: unknown }).ms : body;
      if (typeof ms !== "number" || !(ms >= 0)) fail(`${at}.delay`, "milliseconds, or { ms }");
      delayMs += ms;
      return;
    }
    if (kind === "usage") {
      usage = usageOf(body, `${at}.usage`);
      return;
    }
    turns.push({ action: actionOf(kind, body, `${at}.${kind}`), delayMs, usage });
    delayMs = 0;
    usage = undefined;
  });
  return { turns, delayMs, usage };
}

const KINDS = ["write", "edit", "bash", "read", "output", "raw", "hang", "exit", "delay", "usage"];

/** A step's kind and body: `{ kind: body }`, or a bare `hang` or `exit`. */
function stepKind(step: unknown, path: string): [string, unknown] {
  if (step === "hang" || step === "exit") return [step, true];
  const fields = record(step, path);
  const names = Object.keys(fields);
  const kind = names[0];
  if (names.length !== 1 || kind === undefined || !KINDS.includes(kind)) {
    fail(path, `one of ${KINDS.join(", ")}, as { kind: ... }`);
  }
  return [kind, fields[kind]];
}

function actionOf(kind: string, body: unknown, path: string): Action {
  switch (kind) {
    case "write": {
      const fields = record(body, path);
      return {
        kind,
        path: string(fields.path, `${path}.path`),
        content: string(fields.content, `${path}.content`, true),
      };
    }
    case "edit": {
      const fields = record(body, path);
      if (fields.all !== undefined && typeof fields.all !== "boolean") {
        fail(`${path}.all`, "a boolean");
      }
      return {
        kind,
        path: string(fields.path, `${path}.path`),
        old: string(fields.old, `${path}.old`, true),
        new: string(fields.new, `${path}.new`, true),
        ...(fields.all === undefined ? {} : { all: fields.all as boolean }),
      };
    }
    case "bash": {
      if (typeof body === "string") return { kind, command: string(body, path) };
      const fields = record(body, path);
      return {
        kind,
        command: string(fields.command, `${path}.command`),
        ...(fields.timeout === undefined
          ? {}
          : { timeout: positive(fields.timeout, `${path}.timeout`) }),
        ...(fields.workdir === undefined
          ? {}
          : { workdir: string(fields.workdir, `${path}.workdir`) }),
      };
    }
    case "read": {
      if (typeof body === "string") return { kind, path: string(body, path) };
      const fields = record(body, path);
      return {
        kind,
        path: string(fields.path, `${path}.path`),
        ...(fields.offset === undefined
          ? {}
          : { offset: positive(fields.offset, `${path}.offset`) }),
        ...(fields.limit === undefined ? {} : { limit: positive(fields.limit, `${path}.limit`) }),
      };
    }
    case "output":
      if (body === undefined) fail(path, "the stage's output");
      return { kind, value: body };
    case "raw":
      return { kind, text: string(body, path, true) };
    case "hang":
    case "exit":
      if (body !== true && body !== null) fail(path, "true, or the bare word");
      return { kind };
    default:
      return fail(path, `one of ${KINDS.join(", ")}`);
  }
}

function usageOf(value: unknown, path: string): Usage {
  const fields = record(value, path);
  const count = (name: string) => {
    const item = fields[name];
    if (!Number.isInteger(item) || (item as number) < 0) fail(`${path}.${name}`, "a token count");
    return item as number;
  };
  return {
    prompt: count("prompt"),
    completion: count("completion"),
    ...(fields.cached === undefined ? {} : { cached: count("cached") }),
  };
}

function entries(value: unknown, path: string): [string, unknown][] {
  return Object.entries(record(value, path));
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, empty = false): string {
  if (typeof value !== "string" || (!empty && value === "")) fail(path, "a string");
  return value as string;
}

function positive(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) fail(path, "a positive integer");
  return value as number;
}

function fail(path: string, expected: string): never {
  throw new HttpError(400, { message: `${path}: expected ${expected}.` });
}
