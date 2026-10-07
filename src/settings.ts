import { ENGINES, MODE_ENGINE } from "./inference/engines.ts";
import type { Parsed } from "./output.ts";
import { STAGES } from "./stages.ts";
import { parseYaml, type YamlEntry, type YamlNode } from "./yaml.ts";

export const SETTINGS_FILE = ".codeman/settings.yml";
/** Settings shared by an organization's repositories; Codeman's template fills the input. */
export const SHARED_SETTINGS = "the `settings` input (organization variable CODEMAN_SETTINGS)";
/** Where each layer `resolveSettings` takes comes from, in its order, as the run's log names it. */
export const LAYER_SOURCES = [
  "the task's commands",
  "the workflow's inputs",
  SETTINGS_FILE,
  SHARED_SETTINGS,
] as const;

/** Values a repository can configure. Names match the workflow inputs. */
export interface Settings {
  model: string;
  "task-budget": number;
  "monthly-budget": number;
  /**
   * Spending limit per calendar month of the organization's repositories together; only the
   * organization's settings set it. Undefined: no limit.
   */
  "organization-monthly-budget"?: number | undefined;
  "max-runs": number;
  "max-files": number;
  "max-file-bytes": number;
  /** Limits on what the agent writes for the maintainers; see `src/output.ts`. */
  "max-decisions": number;
  "max-options": number;
  "max-title-chars": number;
  "max-question-chars": number;
  "max-label-chars": number;
  "max-summary-chars": number;
  /** The language Codeman talks to maintainers in: a BCP 47 tag, or `auto` for the issue's. */
  language: string;
  /** Where agent runs get their model: `openrouter`, or `self-hosted` on rented GPUs. */
  inference: string;
  /** The GPU cloud of self-hosted inference: `runpod`. */
  "gpu-provider": string;
  /** `pod`: a GPU rented for the run; `serverless`: an endpoint's workers, started on demand. */
  "gpu-mode": string;
  /** The GPU type of a pod, as the provider names it, such as `NVIDIA RTX A6000`. */
  "gpu-type"?: string | undefined;
  /** What serves the model: `ollama` on pods, `vllm` on Serverless endpoints. */
  engine?: string | undefined;
  /** The ID of the Serverless endpoint a maintainer created. */
  "serverless-endpoint"?: string | undefined;
  /** `task`: a pod serves the task's next run too, while the task goes on; `run`: one run. */
  "pod-reuse": string;
  /** How many tasks one run works on at once, each in its own jobs. */
  "parallel-tasks": number;
}

export type SettingName = keyof Settings;
export type PartialSettings = Partial<Settings>;

/** Codeman's own defaults. There is no default model (see docs/architecture.md). */
export const DEFAULTS: Omit<Settings, "model"> = {
  "task-budget": 2,
  "monthly-budget": 20,
  "max-runs": 3,
  "max-files": 300,
  "max-file-bytes": 1024 * 1024,
  "max-decisions": 10,
  "max-options": 4,
  "max-title-chars": 80,
  "max-question-chars": 600,
  "max-label-chars": 150,
  "max-summary-chars": 2000,
  language: "auto",
  inference: "openrouter",
  "gpu-provider": "runpod",
  "gpu-mode": "pod",
  "pod-reuse": "task",
  "parallel-tasks": 1,
};

/**
 * Bounds of some settings. The output limits keep what the agent writes within a comment of
 * 65,536 characters, GitHub's limit.
 */
export const LIMIT_BOUNDS: Readonly<Partial<Record<SettingName, { min: number; max: number }>>> = {
  "max-decisions": { min: 1, max: 10 },
  "max-options": { min: 2, max: 6 },
  "max-title-chars": { min: 1, max: 200 },
  "max-question-chars": { min: 1, max: 1500 },
  "max-label-chars": { min: 1, max: 300 },
  "max-summary-chars": { min: 1, max: 4000 },
  // Each task runs its own jobs, and may hold its own key or pod, at once.
  "parallel-tasks": { min: 1, max: 10 },
};

/** Settings a maintainer can change for one task with `/codeman set`. */
export const TASK_SETTINGS: ReadonlySet<SettingName> = new Set([
  "model",
  "task-budget",
  "max-runs",
  "language",
  "gpu-type",
]);

/**
 * Settings only the organization's settings may set: a repository must not raise a limit that
 * holds for every repository.
 */
export const ORGANIZATION_SETTINGS: ReadonlySet<SettingName> = new Set([
  "organization-monthly-budget",
]);

/** Settings that take one of a few values. */
export const CHOICES: Readonly<Partial<Record<SettingName, readonly string[]>>> = {
  inference: ["openrouter", "self-hosted"],
  "gpu-provider": ["runpod"],
  "gpu-mode": ["pod", "serverless"],
  engine: Object.keys(ENGINES),
  "pod-reuse": ["task", "run"],
};

const NAMES: readonly SettingName[] = [
  "model",
  "task-budget",
  "monthly-budget",
  "organization-monthly-budget",
  "max-runs",
  "max-files",
  "max-file-bytes",
  "max-decisions",
  "max-options",
  "max-title-chars",
  "max-question-chars",
  "max-label-chars",
  "max-summary-chars",
  "language",
  "inference",
  "gpu-provider",
  "gpu-mode",
  "gpu-type",
  "engine",
  "serverless-endpoint",
  "pod-reuse",
  "parallel-tasks",
];

/** OpenRouter model IDs, such as `deepseek/deepseek-v4.1-flash` or `~deepseek/deepseek-flash-latest`. */
const MODEL_ID = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isModelId(text: string): boolean {
  return text.length <= 100 && MODEL_ID.test(text);
}

/** A model name of OpenRouter or of one of the engines; which one fits is checked once resolved. */
export function isModelName(text: string): boolean {
  return isModelId(text) || Object.values(ENGINES).some((engine) => engine.isModel(text));
}

/** GPU type IDs, such as `NVIDIA GeForce RTX 4090`. */
const GPU_TYPE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,78}[A-Za-z0-9]$/;
/** Serverless endpoint IDs. */
const ENDPOINT_ID = /^[a-z0-9]{1,64}$/i;

/** BCP 47 language tags, such as `pt-BR`, without the rarer extensions. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,3}$/i;

export function isLanguageTag(text: string): boolean {
  return LANGUAGE_TAG.test(text);
}

export type SettingKind =
  | "model"
  | "language"
  | "number"
  | "integer"
  | "choice"
  | "gpu-type"
  | "endpoint";

/** What kind of value a setting takes. */
export function settingKind(name: SettingName): SettingKind {
  if (name === "model" || name === "language" || name === "gpu-type") return name;
  if (name === "serverless-endpoint") return "endpoint";
  if (CHOICES[name]) return "choice";
  return name === "task-budget" ||
    name === "monthly-budget" ||
    name === "organization-monthly-budget"
    ? "number"
    : "integer";
}

export function isSettingName(name: string): name is SettingName {
  return (NAMES as readonly string[]).includes(name);
}

/** Validates one value, given as text. */
export function parseSetting(name: SettingName, text: string): Parsed<string | number> {
  if (name === "model") {
    return isModelName(text)
      ? { ok: true, value: text }
      : {
          ok: false,
          error: `\`${name}\` must be a model ID, such as \`provider/model\` on OpenRouter.`,
        };
  }
  const choices = CHOICES[name];
  if (choices) {
    return choices.includes(text)
      ? { ok: true, value: text }
      : {
          ok: false,
          error: `\`${name}\` must be one of ${choices.map((c) => `\`${c}\``).join(", ")}.`,
        };
  }
  if (name === "gpu-type") {
    return GPU_TYPE.test(text)
      ? { ok: true, value: text }
      : { ok: false, error: `\`${name}\` must be a GPU type, such as \`NVIDIA RTX A6000\`.` };
  }
  if (name === "serverless-endpoint") {
    return ENDPOINT_ID.test(text)
      ? { ok: true, value: text }
      : { ok: false, error: `\`${name}\` must be an endpoint's ID, letters and digits.` };
  }
  if (name === "language") {
    return text === "auto" || isLanguageTag(text)
      ? { ok: true, value: text }
      : {
          ok: false,
          error: `\`${name}\` must be \`auto\` or a language tag, such as \`pt-BR\`.`,
        };
  }
  const value = Number(text);
  const integer = settingKind(name) === "integer";
  if (
    text === "" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (integer && !Number.isInteger(value))
  ) {
    return {
      ok: false,
      error: `\`${name}\` must be a positive ${integer ? "whole number" : "number"}.`,
    };
  }
  const bounds = LIMIT_BOUNDS[name];
  if (bounds && (value < bounds.min || value > bounds.max)) {
    return { ok: false, error: `\`${name}\` must be from ${bounds.min} to ${bounds.max}.` };
  }
  return { ok: true, value };
}

/** Settings an inference profile may change: where the model is served, and which model. */
export const PROFILE_SETTINGS: readonly SettingName[] = [
  "inference",
  "gpu-provider",
  "gpu-mode",
  "gpu-type",
  "engine",
  "serverless-endpoint",
  "pod-reuse",
  "model",
];

/** What a profile's `stages` condition names: planning, routing, and each stage. */
export const PROFILE_STAGES = ["plan", "route", ...STAGES] as const;
export type ProfileStage = (typeof PROFILE_STAGES)[number];

/** The inference settings for some runs: the first profile whose conditions all hold applies. */
export interface InferenceProfile {
  name: string;
  /** Conditions that must all hold; a profile without any always applies. */
  when: {
    stages?: ProfileStage[] | undefined;
    /** The run works on at least this many tasks at once. */
    "parallel-tasks"?: number | undefined;
  };
  /** The settings it changes, of `PROFILE_SETTINGS`. */
  settings: PartialSettings;
}

/** What one layer of settings sets: values, and the whole list of profiles. */
export type SettingsLayer = PartialSettings & {
  "inference-profiles"?: readonly InferenceProfile[] | undefined;
};

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Reads `.codeman/settings.yml`, or settings in its format from `source`, which errors name.
 * The format is a strict subset of YAML (`src/yaml.ts`): `name: value` lines, and the list of
 * `inference-profiles`. Anything else is an error, so the file never means something different
 * from what it looks like.
 */
export function parseSettings(text: string, source = SETTINGS_FILE): Parsed<SettingsLayer> {
  const tree = parseYaml(text);
  if (!tree.ok) return { ok: false, error: `${source}, line ${tree.line}: ${tree.error}` };
  const settings: Record<string, unknown> = {};
  for (const entry of tree.value.entries) {
    const parsed =
      entry.key === "inference-profiles" ? profiles(entry.value) : setting(entry, "setting");
    if (!parsed.ok) return { ok: false, error: `${source}, line ${parsed.line}: ${parsed.error}` };
    if (
      source !== SHARED_SETTINGS &&
      isSettingName(entry.key) &&
      ORGANIZATION_SETTINGS.has(entry.key)
    ) {
      return {
        ok: false,
        error: `${source}, line ${entry.line}: \`${entry.key}\` can be set only in the organization's settings, the CODEMAN_SETTINGS variable.`,
      };
    }
    settings[entry.key] = parsed.value;
  }
  return { ok: true, value: settings as SettingsLayer };
}

/** A parse result whose error names the line it is on. */
type Read<T> = { ok: true; value: T } | { ok: false; line: number; error: string };

function setting(entry: YamlEntry, what: "setting" | "profile"): Read<string | number> {
  const { key: name, line, value } = entry;
  if (!isSettingName(name)) return { ok: false, line, error: `unknown setting \`${name}\`.` };
  if (what === "profile" && !PROFILE_SETTINGS.includes(name)) {
    return {
      ok: false,
      line,
      error: `a profile cannot set \`${name}\`; it sets only ${PROFILE_SETTINGS.map((n) => `\`${n}\``).join(", ")}.`,
    };
  }
  if (value.kind !== "scalar") {
    return { ok: false, line, error: `the value of \`${name}\` is not a plain value.` };
  }
  const parsed = parseSetting(name, value.text);
  return parsed.ok ? parsed : { ok: false, line, error: parsed.error };
}

/** `inference-profiles`: a list of profiles, or `[]` for none. */
function profiles(node: YamlNode): Read<InferenceProfile[]> {
  if (node.kind !== "list" || node.items.some((item) => item.kind !== "map")) {
    return {
      ok: false,
      line: node.kind === "list" ? (node.items[0]?.line ?? node.line) : node.line,
      error: "`inference-profiles` must be a list of profiles, each a block of settings.",
    };
  }
  const list: InferenceProfile[] = [];
  for (const item of node.items) {
    const parsed = profile(item);
    if (!parsed.ok) return parsed;
    if (list.some((other) => other.name === parsed.value.name)) {
      return {
        ok: false,
        line: item.line,
        error: `two profiles are named \`${parsed.value.name}\`.`,
      };
    }
    list.push(parsed.value);
  }
  return { ok: true, value: list };
}

function profile(node: YamlNode): Read<InferenceProfile> {
  if (node.kind !== "map") return { ok: false, line: node.line, error: "expected a profile." };
  const result: InferenceProfile = { name: "", when: {}, settings: {} };
  for (const entry of node.entries) {
    const { key, line, value } = entry;
    if (key === "name") {
      if (value.kind !== "scalar" || !PROFILE_NAME.test(value.text)) {
        return {
          ok: false,
          line,
          error:
            "a profile's `name` must be letters, digits, `.`, `_` or `-`, such as `small-pod`.",
        };
      }
      result.name = value.text;
    } else if (key === "when") {
      const when = conditions(entry);
      if (!when.ok) return when;
      result.when = when.value;
    } else {
      const parsed = setting(entry, "profile");
      if (!parsed.ok) return parsed;
      Object.assign(result.settings, { [key]: parsed.value });
    }
  }
  if (!result.name) return { ok: false, line: node.line, error: "a profile needs a `name`." };
  return { ok: true, value: result };
}

function conditions(entry: YamlEntry): Read<InferenceProfile["when"]> {
  const { line, value } = entry;
  if (value.kind !== "map") {
    return { ok: false, line, error: "`when` must be a block of conditions." };
  }
  const when: InferenceProfile["when"] = {};
  for (const { key, line, value: condition } of value.entries) {
    if (key === "stages") {
      const names = condition.kind === "list" ? condition.items : [];
      const stages = names.flatMap((item) => (item.kind === "scalar" ? [item.text] : []));
      const valid = stages.length === names.length && stages.every(isProfileStage);
      if (names.length === 0 || !valid) {
        return {
          ok: false,
          line,
          error: `\`stages\` must list some of ${PROFILE_STAGES.map((stage) => `\`${stage}\``).join(", ")}, such as \`[plan, route]\`.`,
        };
      }
      when.stages = stages as ProfileStage[];
    } else if (key === "parallel-tasks") {
      const count =
        condition.kind === "scalar" && condition.text !== "" ? Number(condition.text) : Number.NaN;
      if (!Number.isInteger(count) || count < 1) {
        return {
          ok: false,
          line,
          error: "`parallel-tasks` must be a positive whole number: the fewest tasks of the run.",
        };
      }
      when["parallel-tasks"] = count;
    } else {
      return {
        ok: false,
        line,
        error: `unknown condition \`${key}\`; a profile's conditions are \`stages\` and \`parallel-tasks\`.`,
      };
    }
  }
  return { ok: true, value: when };
}

function isProfileStage(value: string): value is ProfileStage {
  return (PROFILE_STAGES as readonly string[]).includes(value);
}

/** What a run's profile depends on: its stage, and how many tasks it works on at once. */
export interface RunConditions {
  stage: ProfileStage;
  tasks: number;
}

/** The settings of one run, and where its inference comes from. */
export interface RunSettings {
  settings: Settings;
  /** The profile that applies; undefined when none does, and the top-level settings do. */
  profile?: string | undefined;
  /**
   * The provider of the top-level settings and of each profile, whose months add up against
   * the monthly budget: `openrouter`, or the GPU provider of self-hosted inference.
   */
  providers: string[];
}

/**
 * Resolves each setting from the first layer that sets it, then Codeman's defaults. The layers
 * are, in order: the task's commands, the workflow inputs, the repository's settings file and
 * the organization's (`LAYER_SOURCES`). The list of profiles is one value: the first layer that
 * has one gives it whole. Then, for a run, the first profile whose conditions hold replaces the
 * top-level values it sets, except those the task's own commands (the first layer) set.
 *
 * The top-level settings and every profile must fit together on their own, without the task's
 * commands, so that a mistake shows on the first run and not when a stage reaches it.
 */
export function resolveRun(
  layers: readonly SettingsLayer[],
  run?: RunConditions,
): Parsed<RunSettings> {
  const [own = {}] = layers;
  const merged = merge(layers);
  const { "inference-profiles": profiles = [], ...values } = merged;
  if (values.model === undefined) {
    return {
      ok: false,
      error: `No model is configured. Set \`model\` in ${SETTINGS_FILE} or in the workflow's inputs.`,
    };
  }
  const forTask = pick(own, PROFILE_SETTINGS);
  // The top level as the layers below the task's commands set it; where none does, as the
  // task's commands do.
  const below = merge(layers.slice(1), {});
  const top: PartialSettings = { ...values };
  for (const name of PROFILE_SETTINGS) {
    if (below[name] !== undefined) Object.assign(top, { [name]: below[name] });
  }
  const topError = inferenceError(top as Settings);
  if (topError) return { ok: false, error: topError };
  for (const profile of profiles) {
    const error = inferenceError({ ...top, ...profile.settings } as Settings);
    if (error) return { ok: false, error: `Inference profile \`${profile.name}\`: ${error}` };
  }

  const chosen = run ? profiles.find((profile) => applies(profile, run)) : undefined;
  const settings = { ...top, ...chosen?.settings, ...forTask } as Settings;
  const error = inferenceError(settings);
  if (error) {
    return { ok: false, error: chosen ? `Inference profile \`${chosen.name}\`: ${error}` : error };
  }
  if (settings.inference === "self-hosted") {
    settings.engine ??= MODE_ENGINE[settings["gpu-mode"] as keyof typeof MODE_ENGINE];
  }
  const providers = [top, ...profiles.map((profile) => ({ ...top, ...profile.settings }))].map(
    (layer) => (layer.inference === "self-hosted" ? (layer["gpu-provider"] ?? "") : "openrouter"),
  );
  return {
    ok: true,
    value: { settings, profile: chosen?.name, providers: [...new Set(providers)] },
  };
}

/** The top-level settings, as `resolveRun` resolves them when no profile applies. */
export function resolveSettings(...layers: SettingsLayer[]): Parsed<Settings> {
  const resolved = resolveRun(layers);
  return resolved.ok ? { ok: true, value: resolved.value.settings } : resolved;
}

/** Whether all of a profile's conditions hold for a run. */
export function applies(profile: InferenceProfile, run: RunConditions): boolean {
  const { stages, "parallel-tasks": tasks } = profile.when;
  return (!stages || stages.includes(run.stage)) && (tasks === undefined || run.tasks >= tasks);
}

function merge(
  layers: readonly SettingsLayer[],
  defaults: PartialSettings = DEFAULTS,
): SettingsLayer {
  const merged: SettingsLayer = { ...defaults };
  for (const layer of [...layers].reverse()) {
    for (const [name, value] of Object.entries(layer)) {
      if (value !== undefined) Object.assign(merged, { [name]: value });
    }
  }
  return merged;
}

function pick(layer: PartialSettings, names: readonly SettingName[]): PartialSettings {
  return Object.fromEntries(
    Object.entries(layer).filter(
      ([name, value]) => value !== undefined && (names as readonly string[]).includes(name),
    ),
  );
}

/**
 * For the run's log: a line per layer of `resolveSettings` that a resolved value comes from,
 * with those values. Values are short and hold no secrets; settings never do. A list of
 * profiles shows their names. The values no line names are Codeman's defaults.
 */
export function settingSources(layers: readonly SettingsLayer[]): string[] {
  const named = new Set<string>();
  const show = (value: unknown) =>
    Array.isArray(value)
      ? `[${value.map((profile: InferenceProfile) => profile.name).join(", ")}]`
      : String(value);
  return layers.flatMap((layer, index) => {
    const values = Object.entries(layer).filter(
      ([name, value]) => value !== undefined && !named.has(name),
    );
    if (values.length === 0) return [];
    for (const [name] of values) named.add(name);
    const source = LAYER_SOURCES[index] ?? `layer ${index + 1}`;
    return [`Settings from ${source}: ${values.map(([n, v]) => `${n}=${show(v)}`).join(", ")}.`];
  });
}

/** Why the inference settings do not fit together; undefined when they do. */
function inferenceError(settings: Settings): string | undefined {
  if (settings.inference !== "self-hosted") {
    return isModelId(settings.model)
      ? undefined
      : `\`model\` must be an OpenRouter model ID, such as \`provider/model\`, not \`${settings.model}\`.`;
  }
  const mode = settings["gpu-mode"] as keyof typeof MODE_ENGINE;
  const engine = settings.engine ?? MODE_ENGINE[mode];
  if (engine !== MODE_ENGINE[mode]) {
    return `With \`gpu-mode: ${mode}\`, the engine is \`${MODE_ENGINE[mode]}\`, not \`${engine}\`.`;
  }
  if (mode === "pod" && !settings["gpu-type"]) {
    return `Self-hosted inference on pods needs \`gpu-type\`, such as \`"NVIDIA RTX A6000"\`, in ${SETTINGS_FILE}.`;
  }
  if (mode === "serverless" && !settings["serverless-endpoint"]) {
    return `Self-hosted inference on Serverless needs \`serverless-endpoint\` in ${SETTINGS_FILE}.`;
  }
  const model = ENGINES[engine];
  if (model && !model.isModel(settings.model)) {
    return `\`model\` must be a ${engine} model name, such as \`${model.example}\`, not \`${settings.model}\`.`;
  }
  return undefined;
}
