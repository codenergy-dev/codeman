import { parse as parseYaml } from "yaml";
import {
  AVAILABILITY,
  conditionExpression,
  ExpressionError,
  expressionsIn,
  type KeyKind,
  parse,
  type Scope,
} from "./expressions.ts";

/**
 * A workflow file as the simulator runs it, read with `yaml`. Only the keys the simulator
 * implements are accepted: any other throws a `WorkflowError` naming the file and the key, and
 * every expression is parsed at load, so a template change outside the subset is noticed before
 * a run starts.
 */

export class WorkflowError extends Error {
  constructor(file: string, key: string, detail: string) {
    super(`${file}: ${key}: ${detail}`);
    this.name = "WorkflowError";
  }
}

/** A `GITHUB_TOKEN` permission's level; `none` is left out. */
export type Permissions = Record<string, "read" | "write">;

/** The names GitHub's `permissions` key takes. */
export const PERMISSION_NAMES = [
  "actions",
  "artifact-metadata",
  "attestations",
  "checks",
  "code-quality",
  "contents",
  "copilot-requests",
  "deployments",
  "discussions",
  "id-token",
  "issues",
  "models",
  "packages",
  "pages",
  "pull-requests",
  "security-events",
  "statuses",
  "vulnerability-alerts",
] as const;

export interface InputSpec {
  type: "string" | "boolean" | "number" | "choice";
  required: boolean;
  default?: unknown;
}

export interface Trigger {
  /** The activity types the workflow runs for; undefined is all of them. */
  types?: string[];
  /** `schedule`'s cron lines. */
  crons?: string[];
}

export interface StepSpec {
  index: number;
  /** Where the step is, as `jobs.<id>.steps[<index>]`. */
  key: string;
  id?: string;
  name?: unknown;
  if?: unknown;
  uses?: string;
  run?: string;
  shell?: string;
  with: Record<string, unknown>;
  env: Record<string, unknown>;
  continueOnError?: unknown;
  timeoutMinutes?: unknown;
  workingDirectory?: unknown;
}

export interface JobSpec {
  id: string;
  name?: unknown;
  needs: string[];
  if?: unknown;
  runsOn?: unknown;
  timeoutMinutes?: unknown;
  permissions?: Permissions;
  outputs: Record<string, unknown>;
  env: Record<string, unknown>;
  strategy?: { matrix: unknown; failFast: unknown; maxParallel: unknown };
  steps: StepSpec[];
  /** A reusable workflow, such as `./.github/workflows/codeman-task.yml`. */
  uses?: string;
  with: Record<string, unknown>;
  secrets?: "inherit" | Record<string, unknown>;
}

export interface Workflow {
  /** The file's path in the repository, such as `.github/workflows/codeman.yml`. */
  file: string;
  name?: string;
  on: Map<string, Trigger>;
  dispatchInputs: Map<string, InputSpec>;
  call?: {
    inputs: Map<string, InputSpec>;
    outputs: Map<string, unknown>;
    secrets: Map<string, { required: boolean }>;
  };
  permissions?: Permissions;
  env: Record<string, unknown>;
  concurrency?: { group: unknown; cancelInProgress: unknown };
  /** In the file's order. */
  jobs: Map<string, JobSpec>;
}

/** An expression of a workflow file, with where it is and what it may use there. */
export interface Located {
  key: string;
  kind: KeyKind;
  /** The expression, without `${{ }}`. */
  expression: string;
  /** Whether it is an `if:`, which may call the status functions. */
  condition: boolean;
}

type Raw = Record<string, unknown>;

const WORKFLOW_KEYS = ["name", "on", "permissions", "env", "concurrency", "jobs", "run-name"];
const JOB_KEYS = [
  "name",
  "needs",
  "if",
  "runs-on",
  "timeout-minutes",
  "permissions",
  "outputs",
  "env",
  "strategy",
  "steps",
  "uses",
  "with",
  "secrets",
];
const STEP_KEYS = [
  "id",
  "name",
  "if",
  "uses",
  "run",
  "shell",
  "with",
  "env",
  "continue-on-error",
  "timeout-minutes",
  "working-directory",
];
const TRIGGER_KEYS: Record<string, string[]> = {
  workflow_dispatch: ["inputs"],
  workflow_call: ["inputs", "outputs", "secrets"],
};

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads and checks a workflow file. */
export function loadWorkflow(source: string, file: string): Workflow {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new WorkflowError(file, "(file)", `not valid YAML: ${(error as Error).message}`);
  }
  const fail = (key: string, detail: string): never => {
    throw new WorkflowError(file, key, detail);
  };
  if (!isObject(raw)) return fail("(file)", "not a mapping");
  const only = (value: Raw, keys: readonly string[], at: string) => {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(at ? `${at}.${key}` : key, "not supported by the simulator");
    }
  };
  const mapping = (value: unknown, at: string): Raw => {
    if (value === undefined || value === null) return {};
    if (!isObject(value)) return fail(at, "must be a mapping");
    return value;
  };
  only(raw, WORKFLOW_KEYS, "");
  if (raw["run-name"] !== undefined) fail("run-name", "not supported by the simulator");

  const workflow: Workflow = {
    file,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    on: new Map(),
    dispatchInputs: new Map(),
    env: mapping(raw.env, "env"),
    jobs: new Map(),
  };

  // Triggers
  const on = raw.on;
  const events: [string, unknown][] =
    typeof on === "string"
      ? [[on, null]]
      : Array.isArray(on)
        ? on.map((name) => [String(name), null])
        : isObject(on)
          ? Object.entries(on)
          : fail("on", "must name the events");
  for (const [event, config] of events) {
    const at = `on.${event}`;
    if (event === "schedule") {
      if (!Array.isArray(config)) fail(at, "must be a list of crons");
      const crons = (config as unknown[]).map((entry, index) => {
        if (!isObject(entry) || typeof entry.cron !== "string") {
          return fail(`${at}[${index}]`, "must be { cron: <text> }");
        }
        return entry.cron;
      });
      workflow.on.set(event, { crons });
      continue;
    }
    const settings = mapping(config, at);
    only(settings, ["types", ...(TRIGGER_KEYS[event] ?? [])], at);
    const trigger: Trigger = {};
    if (settings.types !== undefined) {
      const types = Array.isArray(settings.types) ? settings.types : [settings.types];
      trigger.types = types.map(String);
    }
    workflow.on.set(event, trigger);
    if (event === "workflow_dispatch") {
      workflow.dispatchInputs = inputs(mapping(settings.inputs, `${at}.inputs`), `${at}.inputs`);
    }
    if (event === "workflow_call") {
      const outputs = new Map<string, unknown>();
      for (const [name, output] of Object.entries(mapping(settings.outputs, `${at}.outputs`))) {
        const spec = mapping(output, `${at}.outputs.${name}`);
        only(spec, ["description", "value"], `${at}.outputs.${name}`);
        outputs.set(name, spec.value);
      }
      const secrets = new Map<string, { required: boolean }>();
      for (const [name, secret] of Object.entries(mapping(settings.secrets, `${at}.secrets`))) {
        const spec = mapping(secret, `${at}.secrets.${name}`);
        only(spec, ["description", "required"], `${at}.secrets.${name}`);
        secrets.set(name, { required: spec.required === true });
      }
      workflow.call = {
        inputs: inputs(mapping(settings.inputs, `${at}.inputs`), `${at}.inputs`),
        outputs,
        secrets,
      };
    }
  }

  function inputs(specs: Raw, at: string): Map<string, InputSpec> {
    const found = new Map<string, InputSpec>();
    for (const [name, value] of Object.entries(specs)) {
      const spec = mapping(value, `${at}.${name}`);
      only(spec, ["description", "type", "required", "default", "options"], `${at}.${name}`);
      const type = spec.type ?? "string";
      if (type !== "string" && type !== "boolean" && type !== "number" && type !== "choice") {
        fail(`${at}.${name}.type`, `the type ${String(type)} is not supported`);
      }
      found.set(name, {
        type: type as InputSpec["type"],
        required: spec.required === true,
        ...(spec.default !== undefined ? { default: spec.default } : {}),
      });
    }
    return found;
  }

  // Permissions and concurrency
  if (raw.permissions !== undefined) {
    workflow.permissions = permissions(raw.permissions, "permissions", fail);
  }
  if (raw.concurrency !== undefined) {
    if (typeof raw.concurrency === "string") {
      workflow.concurrency = { group: raw.concurrency, cancelInProgress: false };
    } else {
      const spec = mapping(raw.concurrency, "concurrency");
      only(spec, ["group", "cancel-in-progress"], "concurrency");
      if (spec.group === undefined) fail("concurrency.group", "is required");
      workflow.concurrency = {
        group: spec.group,
        cancelInProgress: spec["cancel-in-progress"] ?? false,
      };
    }
  }

  // Jobs
  const jobs = mapping(raw.jobs, "jobs");
  if (Object.keys(jobs).length === 0) fail("jobs", "no job");
  for (const [id, value] of Object.entries(jobs)) {
    const at = `jobs.${id}`;
    const spec = mapping(value, at);
    only(spec, JOB_KEYS, at);
    const needs =
      spec.needs === undefined
        ? []
        : Array.isArray(spec.needs)
          ? spec.needs.map(String)
          : [String(spec.needs)];
    const job: JobSpec = {
      id,
      ...(spec.name !== undefined ? { name: spec.name } : {}),
      needs,
      ...(spec.if !== undefined ? { if: spec.if } : {}),
      ...(spec["runs-on"] !== undefined ? { runsOn: spec["runs-on"] } : {}),
      ...(spec["timeout-minutes"] !== undefined ? { timeoutMinutes: spec["timeout-minutes"] } : {}),
      outputs: mapping(spec.outputs, `${at}.outputs`),
      env: mapping(spec.env, `${at}.env`),
      steps: [],
      with: mapping(spec.with, `${at}.with`),
    };
    if (spec.permissions !== undefined) {
      job.permissions = permissions(spec.permissions, `${at}.permissions`, fail);
    }
    if (spec.strategy !== undefined) {
      const strategy = mapping(spec.strategy, `${at}.strategy`);
      only(strategy, ["matrix", "fail-fast", "max-parallel"], `${at}.strategy`);
      if (strategy.matrix === undefined) fail(`${at}.strategy.matrix`, "is required");
      job.strategy = {
        matrix: strategy.matrix,
        failFast: strategy["fail-fast"] ?? true,
        maxParallel: strategy["max-parallel"],
      };
    }
    if (spec.uses !== undefined) {
      if (typeof spec.uses !== "string") fail(`${at}.uses`, "must be text");
      if (spec.steps !== undefined) fail(`${at}.steps`, "a job that calls a workflow has no steps");
      for (const key of ["runs-on", "env", "outputs", "timeout-minutes"]) {
        if (spec[key] !== undefined)
          fail(`${at}.${key}`, "a job that calls a workflow cannot set it");
      }
      job.uses = spec.uses as string;
      if (spec.secrets === "inherit") job.secrets = "inherit";
      else if (spec.secrets !== undefined) job.secrets = mapping(spec.secrets, `${at}.secrets`);
    } else {
      if (spec.with !== undefined || spec.secrets !== undefined) {
        fail(`${at}.with`, "only a job that calls a workflow takes with and secrets");
      }
      if (!Array.isArray(spec.steps) || spec.steps.length === 0) fail(`${at}.steps`, "no step");
      job.steps = (spec.steps as unknown[]).map((entry, index) => {
        const key = `${at}.steps[${index}]`;
        const step = mapping(entry, key);
        only(step, STEP_KEYS, key);
        if ((step.uses === undefined) === (step.run === undefined)) {
          fail(key, "a step has either uses or run");
        }
        if (step.uses !== undefined && typeof step.uses !== "string")
          fail(`${key}.uses`, "must be text");
        if (step.run !== undefined && typeof step.run !== "string")
          fail(`${key}.run`, "must be text");
        if (step.shell !== undefined && typeof step.shell !== "string")
          fail(`${key}.shell`, "must be text");
        if (step.id !== undefined && !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(step.id))) {
          fail(`${key}.id`, "must start with a letter or _ and hold only letters, digits, - and _");
        }
        return {
          index,
          key,
          ...(step.id !== undefined ? { id: String(step.id) } : {}),
          ...(step.name !== undefined ? { name: step.name } : {}),
          ...(step.if !== undefined ? { if: step.if } : {}),
          ...(typeof step.uses === "string" ? { uses: step.uses } : {}),
          ...(typeof step.run === "string" ? { run: step.run } : {}),
          ...(typeof step.shell === "string" ? { shell: step.shell } : {}),
          with: mapping(step.with, `${key}.with`),
          env: mapping(step.env, `${key}.env`),
          ...(step["continue-on-error"] !== undefined
            ? { continueOnError: step["continue-on-error"] }
            : {}),
          ...(step["timeout-minutes"] !== undefined
            ? { timeoutMinutes: step["timeout-minutes"] }
            : {}),
          ...(step["working-directory"] !== undefined
            ? { workingDirectory: step["working-directory"] }
            : {}),
        };
      });
      const ids = job.steps.flatMap((step) => (step.id ? [step.id] : []));
      const twice = ids.find((stepId, index) => ids.indexOf(stepId) !== index);
      if (twice) fail(`${at}.steps`, `the id ${twice} is used twice`);
    }
    workflow.jobs.set(id, job);
  }
  for (const job of workflow.jobs.values()) {
    for (const need of job.needs) {
      if (!workflow.jobs.has(need)) fail(`jobs.${job.id}.needs`, `no job ${need}`);
    }
  }
  const cycle = findCycle(workflow);
  if (cycle) fail("jobs", `the needs form a cycle: ${cycle.join(" > ")}`);

  for (const located of locatedExpressions(raw, file)) {
    parse(located.expression, scopeOf(file, located));
  }
  return workflow;
}

/** The scope an expression is parsed and evaluated in. */
export function scopeOf(file: string, located: Located): Scope {
  return {
    file,
    key: located.key,
    contexts: AVAILABILITY[located.kind],
    status: located.condition,
  };
}

function findCycle(workflow: Workflow): string[] | undefined {
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): string[] | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    for (const need of workflow.jobs.get(id)?.needs ?? []) {
      const found = visit(need, [...path, id]);
      if (found) return found;
    }
    state.set(id, "done");
    return undefined;
  };
  for (const id of workflow.jobs.keys()) {
    const found = visit(id, []);
    if (found) return found;
  }
  return undefined;
}

function permissions(
  value: unknown,
  at: string,
  fail: (key: string, detail: string) => never,
): Permissions {
  if (value === "read-all" || value === "write-all") {
    // id-token takes write or none: read-all leaves it out.
    const level = value === "read-all" ? "read" : "write";
    return Object.fromEntries(
      PERMISSION_NAMES.filter((name) => level === "write" || name !== "id-token").map((name) => [
        name,
        level,
      ]),
    );
  }
  if (!isObject(value)) return fail(at, "must be a mapping, read-all or write-all");
  const found: Permissions = {};
  for (const [name, level] of Object.entries(value)) {
    if (!(PERMISSION_NAMES as readonly string[]).includes(name)) {
      fail(`${at}.${name}`, "not a GITHUB_TOKEN permission");
    }
    if (level === "none") continue;
    if (level !== "read" && level !== "write") fail(`${at}.${name}`, "must be read, write or none");
    found[name] = level as "read" | "write";
  }
  return found;
}

/** What kind of key a path is, for the contexts its expressions may use. */
function kindOf(path: readonly (string | number)[]): KeyKind {
  const [top, second, third, fourth, fifth] = path;
  if (top === "concurrency") return "concurrency";
  if (top === "env") return "workflow.env";
  if (top === "on") {
    return second === "workflow_call" && third === "outputs" && path[4] === "value"
      ? "call.outputs"
      : "none";
  }
  if (top !== "jobs" || path.length < 3) return "none";
  switch (third) {
    case "if":
      return "job.if";
    case "name":
    case "runs-on":
    case "timeout-minutes":
      return "job.name";
    case "strategy":
      return "job.strategy";
    case "with":
      return "job.with";
    case "secrets":
      return "job.secrets";
    case "env":
      return "job.env";
    case "outputs":
      return "job.outputs";
    case "steps":
      if (fourth === undefined || fifth === undefined) return "none";
      if (fifth === "if") return "step.if";
      if (fifth === "uses" || fifth === "id") return "none";
      return "step";
    default:
      return "none";
  }
}

/** Every expression of a parsed workflow, with its key and kind. */
export function locatedExpressions(raw: unknown, file: string): Located[] {
  const found: Located[] = [];
  const walk = (value: unknown, path: (string | number)[]) => {
    const key = path
      .map((part, index) => (typeof part === "number" ? `[${part}]` : index ? `.${part}` : part))
      .join("");
    const last = path.at(-1);
    const condition =
      last === "if" &&
      path[0] === "jobs" &&
      (path.length === 3 || (path.length === 5 && path[2] === "steps"));
    if (condition) {
      found.push({
        key,
        kind: kindOf(path),
        expression: conditionExpression(value, { file, key }),
        condition: true,
      });
      return;
    }
    if (typeof value === "string") {
      for (const expression of expressionsIn(value, { file, key })) {
        found.push({ key, kind: kindOf(path), expression, condition: false });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) walk(item, [...path, index]);
    } else if (isObject(value)) {
      for (const [name, item] of Object.entries(value)) {
        if (typeof name === "string" && name.includes("${{")) {
          throw new ExpressionError({ file, key }, name, "an expression in a key is not supported");
        }
        walk(item, [...path, name]);
      }
    }
  };
  walk(raw, []);
  return found;
}

/** Every expression of a workflow file's text. */
export function workflowExpressions(source: string, file: string): Located[] {
  return locatedExpressions(parseYaml(source), file);
}
