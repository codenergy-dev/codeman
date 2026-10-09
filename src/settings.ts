import { ENGINES } from "./inference/engines.ts";
import { type OllamaSettings, ollamaSetting } from "./inference/ollama.ts";
import {
  accountOf,
  endpointId,
  isOpenRouterModel,
  PROVIDER_BLOCKS,
  PROVIDER_NAMES,
  PROVIDER_SETTINGS,
  PROVIDERS,
  type ProviderName,
  type ProviderSettingName,
  providerProblem,
  settingValues,
  withProviderDefaults,
} from "./inference/providers.ts";
import type { Parsed } from "./output.ts";
import { isStage, STAGES, type Stage } from "./stages.ts";
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

/** How an error names each layer of `LAYER_SOURCES` as the base another inherits from. */
const LAYER_BASES = [
  "the task's commands",
  "the workflow's inputs",
  SETTINGS_FILE,
  "the organization's settings",
] as const;

/** Values a repository can configure. Names match the workflow inputs. */
export interface Settings {
  /**
   * The model ID, in the form the provider takes. Empty only in the settings of a run without an
   * agent (recording answers, accepting workflows) when no layer sets one.
   */
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
  /**
   * Where agent runs get their model: `openrouter`, `runpod-pod` or `runpod-serverless`. The
   * settings that follow it are accepted only by some providers (`src/inference/providers.ts`).
   */
  provider: ProviderName;
  /** What serves the model: `ollama` on pods, `vllm` on Serverless endpoints. */
  engine?: string | undefined;
  /** The GPU type of a pod, as the provider names it, such as `NVIDIA RTX A6000`. */
  gpu?: string | undefined;
  /** The ID of the Serverless endpoint a maintainer created. */
  endpoint?: string | undefined;
  /** `task`: a pod serves the task's next run too, while the task goes on; `run`: one run. */
  "pod-reuse"?: string | undefined;
  /**
   * The pod's Ollama settings, by key, such as `{ "num-parallel": "4" }`: each becomes a variable
   * of its Ollama server (`OLLAMA_SETTINGS` in `src/inference/ollama.ts`).
   */
  ollama?: OllamaSettings | undefined;
}

export type SettingName = keyof Settings;
export type PartialSettings = Partial<Settings>;

/** Codeman's own defaults. There is no default model: no setting is required (see docs/settings/reference.md). */
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
  provider: "openrouter",
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
};

/**
 * Codeman's cap on the tasks one run works on at once: each runs its own jobs, and may hold its
 * own key or pod. A profile's counts are from 1 to this.
 */
export const MAX_TASKS = 10;

/** Settings a maintainer can change for one task with `/codeman set`. */
export const TASK_SETTINGS: ReadonlySet<SettingName> = new Set([
  "model",
  "task-budget",
  "max-runs",
  "language",
  "gpu",
]);

/** Settings a task could change with `/codeman set` under an older name, and their names now. */
export const RENAMED_TASK_SETTINGS: Readonly<Record<string, SettingName>> = { "gpu-type": "gpu" };

/**
 * Settings only the organization's settings may set: a repository must not raise a limit that
 * holds for every repository.
 */
export const ORGANIZATION_SETTINGS: ReadonlySet<SettingName> = new Set([
  "organization-monthly-budget",
]);

/** Settings that take one of a few values. */
export const CHOICES: Readonly<Partial<Record<SettingName, readonly string[]>>> = {
  provider: PROVIDER_NAMES,
  engine: settingValues("engine"),
  "pod-reuse": settingValues("pod-reuse"),
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
  "provider",
  ...PROVIDER_SETTINGS,
];

/** A model name of OpenRouter or of one of the engines; which one fits is checked once resolved. */
export function isModelName(text: string): boolean {
  return isOpenRouterModel(text) || Object.values(ENGINES).some((engine) => engine.isModel(text));
}

/** GPU type IDs, such as `NVIDIA GeForce RTX 4090`. */
const GPU_TYPE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,78}[A-Za-z0-9]$/;

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
  | "gpu"
  | "endpoint";

/** What kind of value a setting takes. */
export function settingKind(name: SettingName): SettingKind {
  if (name === "model" || name === "language" || name === "gpu" || name === "endpoint") {
    return name;
  }
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
  if (name === "ollama") return { ok: false, error: OLLAMA_BLOCK };
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
  if (name === "gpu") {
    return GPU_TYPE.test(text)
      ? { ok: true, value: text }
      : { ok: false, error: `\`${name}\` must be a GPU type, such as \`NVIDIA RTX A6000\`.` };
  }
  if (name === "endpoint") return endpointId(text);
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

/** Settings a profile may change: where the model is served, and which model. */
export const PROFILE_SETTINGS: readonly SettingName[] = [
  "provider",
  "model",
  ...PROVIDER_SETTINGS,
  ...PROVIDER_BLOCKS,
];

/** The settings that go with a provider: dropped by a layer or profile that changes provider. */
const PROVIDER_KEYS: readonly string[] = [...PROVIDER_SETTINGS, ...PROVIDER_BLOCKS];

const OLLAMA_BLOCK =
  "`ollama` must be a block of Ollama's settings, one `name: value` per line, indented under it, such as `num-parallel: 4`.";

/**
 * Names settings had before the provider settings plan, and what to write instead (decision 7):
 * an old name stops the run, so each thing has one name.
 */
export function renamedSetting(name: string, value?: string): string | undefined {
  const now = (text: string) => `\`${name}\` is now ${text}.`;
  switch (name) {
    case "inference":
      if (value === "openrouter") return now("`provider`: write `provider: openrouter`");
      return now(
        value === "self-hosted"
          ? "`provider`: write `provider: runpod-pod` or `provider: runpod-serverless`"
          : `\`provider\`: ${PROVIDER_NAMES.map((provider) => `\`${provider}\``).join(", ")}`,
      );
    case "gpu-provider":
      return now(
        "part of `provider`: write `provider: runpod-pod` or `provider: runpod-serverless`",
      );
    case "gpu-mode":
      if (value === "pod" || value === "serverless") {
        return now(`part of \`provider\`: write \`provider: runpod-${value}\``);
      }
      return now(
        "part of `provider`: write `provider: runpod-pod` or `provider: runpod-serverless`",
      );
    case "gpu-type":
      return now("`gpu`");
    case "serverless-endpoint":
      return now("`endpoint`, with `provider: runpod-serverless`");
    case "inference-profiles":
      return now("`profiles`");
    default:
      return undefined;
  }
}

/** A profile's conditions, written at its first level beside its `name`. */
export const CONDITION_NAMES = ["stages", "tasks", "min-tasks", "max-tasks"] as const;

export type ConditionName = (typeof CONDITION_NAMES)[number];

function isConditionName(name: string): name is ConditionName {
  return (CONDITION_NAMES as readonly string[]).includes(name);
}

/** What a profile's conditions require; an absent one holds for every run. */
export interface Conditions {
  /** The stages it applies to, any of `STAGES`. */
  stages?: Stage[] | undefined;
  /** The run works on exactly this many tasks that run an agent. */
  tasks?: number | undefined;
  /** The run works on at least this many tasks that run an agent. */
  "min-tasks"?: number | undefined;
  /** The run works on at most this many tasks that run an agent. */
  "max-tasks"?: number | undefined;
}

/**
 * A rule that picks a provider, a model and that provider's settings for some runs: the first
 * profile whose conditions all hold applies.
 */
export interface Profile {
  name: string;
  /** Conditions that must all hold; a profile without any always applies. */
  conditions: Conditions;
  /** The settings it changes, of `PROFILE_SETTINGS`. */
  settings: PartialSettings;
}

/** What one layer of settings sets: values, and the whole list of profiles. */
export type SettingsLayer = PartialSettings & {
  profiles?: readonly Profile[] | undefined;
};

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Reads `.codeman/settings.yml`, or settings in its format from `source`, which errors name.
 * The format is a strict subset of YAML (`src/yaml.ts`): `name: value` lines, and the list of
 * `profiles`. Anything else is an error, so the file never means something different from what
 * it looks like.
 */
export function parseSettings(text: string, source = SETTINGS_FILE): Parsed<SettingsLayer> {
  const tree = parseYaml(text);
  if (!tree.ok) return { ok: false, error: `${source}, line ${tree.line}: ${tree.error}` };
  const settings: Record<string, unknown> = {};
  for (const entry of tree.value.entries) {
    const parsed =
      entry.key === "profiles"
        ? profiles(entry.value)
        : entry.key === "ollama"
          ? ollamaBlock(entry)
          : setting(entry, "setting");
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

/** `ollama`: a block of Ollama's settings, each checked against the list, on its own line. */
function ollamaBlock(entry: YamlEntry): Read<OllamaSettings> {
  const { line, value } = entry;
  if (value.kind !== "map") return { ok: false, line, error: OLLAMA_BLOCK };
  const settings: Record<string, string> = {};
  for (const { key, line: keyLine, value: keyValue } of value.entries) {
    if (keyValue.kind !== "scalar") {
      return {
        ok: false,
        line: keyLine,
        error: `the value of \`ollama\`'s \`${key}\` is not a plain value.`,
      };
    }
    const checked = ollamaSetting(key, keyValue.text);
    if (!checked.ok) return { ok: false, line: keyLine, error: checked.error };
    settings[key] = checked.value;
  }
  return { ok: true, value: settings };
}

function setting(entry: YamlEntry, what: "setting" | "profile"): Read<string | number> {
  const { key: name, line, value } = entry;
  const text = value.kind === "scalar" ? value.text : undefined;
  const renamed = renamedSetting(name, text);
  if (renamed) return { ok: false, line, error: renamed };
  const misplaced = misplacedCondition(name, what, text);
  if (misplaced) return { ok: false, line, error: misplaced };
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

/**
 * Where a condition, or a setting the profiles' conditions replaced, was written, what to write
 * instead (decision 2 of the plan for profiles that pick the tasks): conditions belong to
 * profiles, at their first level, since the top level applies when no profile does; `when` and
 * `parallel-tasks` are gone.
 */
function misplacedCondition(
  name: string,
  what: "setting" | "profile",
  value: string | undefined,
): string | undefined {
  const count = value !== undefined && /^[1-9][0-9]*$/.test(value) ? value : "N";
  if (name === "when") {
    return what === "profile"
      ? "`when` is gone: write the profile's conditions (`stages`, `tasks`, `min-tasks`, `max-tasks`) directly in the profile, beside its `name`."
      : "`when` is gone, and conditions belong to profiles: write them in a profile, under `profiles`, beside its `name`. The top-level settings apply when no profile does.";
  }
  if (name === "parallel-tasks") {
    return what === "profile"
      ? `\`parallel-tasks\` is no longer a condition: write \`min-tasks: ${count}\` for at least ${count} tasks in the run, or \`tasks: ${count}\` for exactly ${count}.`
      : `\`parallel-tasks\` is no longer a setting: a run takes as many tasks as its profiles' \`tasks\`, \`min-tasks\` and \`max-tasks\` allow, and one at a time when none sets them. For up to ${count} tasks at once, write \`max-tasks: ${count}\` in a profile.`;
  }
  if (what === "setting" && isConditionName(name)) {
    return `\`${name}\` is a profile's condition: write it in a profile, under \`profiles\`. The top-level settings apply when no profile does.`;
  }
  return undefined;
}

/** `profiles`: a list of profiles, or `[]` for none. */
function profiles(node: YamlNode): Read<Profile[]> {
  if (node.kind !== "list" || node.items.some((item) => item.kind !== "map")) {
    return {
      ok: false,
      line: node.kind === "list" ? (node.items[0]?.line ?? node.line) : node.line,
      error: "`profiles` must be a list of profiles, each a block of settings.",
    };
  }
  const list: Profile[] = [];
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

function profile(node: YamlNode): Read<Profile> {
  if (node.kind !== "map") return { ok: false, line: node.line, error: "expected a profile." };
  const result: Profile = { name: "", conditions: {}, settings: {} };
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
    } else if (isConditionName(key)) {
      const parsed = condition(entry, key);
      if (!parsed.ok) return parsed;
      Object.assign(result.conditions, { [key]: parsed.value });
    } else if (key === "ollama") {
      const parsed = ollamaBlock(entry);
      if (!parsed.ok) return parsed;
      result.settings.ollama = parsed.value;
    } else {
      const parsed = setting(entry, "profile");
      if (!parsed.ok) return parsed;
      Object.assign(result.settings, { [key]: parsed.value });
    }
  }
  if (!result.name) return { ok: false, line: node.line, error: "a profile needs a `name`." };
  const { tasks, "min-tasks": min, "max-tasks": max } = result.conditions;
  if (tasks !== undefined && (min !== undefined || max !== undefined)) {
    return {
      ok: false,
      line: node.line,
      error:
        "`tasks` is an exact count: write it alone, or `min-tasks` and `max-tasks` for a range.",
    };
  }
  if (min !== undefined && max !== undefined && min > max) {
    return {
      ok: false,
      line: node.line,
      error: "`min-tasks` must not be more than `max-tasks`.",
    };
  }
  return { ok: true, value: result };
}

function condition(entry: YamlEntry, name: ConditionName): Read<Stage[] | number> {
  const { line, value } = entry;
  if (name === "stages") {
    const names = value.kind === "list" ? value.items : [];
    const stages = names.flatMap((item) => (item.kind === "scalar" ? [item.text] : []));
    const valid = stages.length === names.length && stages.every(isStage);
    if (names.length === 0 || !valid) {
      return {
        ok: false,
        line,
        error: `\`stages\` must list some of the stages ${STAGES.map((stage) => `\`${stage}\``).join(", ")}, such as \`[plan, route]\`.`,
      };
    }
    return { ok: true, value: stages as Stage[] };
  }
  const count = value.kind === "scalar" && value.text !== "" ? Number(value.text) : Number.NaN;
  if (!Number.isInteger(count) || count < 1 || count > MAX_TASKS) {
    return {
      ok: false,
      line,
      error: `\`${name}\` must be a whole number from 1 to ${MAX_TASKS}: the tasks of the run that run an agent.`,
    };
  }
  return { ok: true, value: count };
}

/** What a run's profile depends on: its stage, and how many tasks it works on at once. */
export interface RunConditions {
  stage: Stage;
  /** The run's tasks that run an agent, whatever their stage. */
  tasks: number;
}

/** The settings of one run, and where its model is served. */
export interface RunSettings {
  settings: Settings;
  /** The profile that applies; undefined when none does, and the top-level settings do. */
  profile?: string | undefined;
  /**
   * The account of the top-level settings' provider and of each profile's, whose months add up
   * against the monthly budget: `openrouter` or `runpod`.
   */
  accounts: string[];
}

/** The top level and the profiles, each resolved and checked, with what the task sets. */
interface Resolved {
  /** The top-level settings; without a model, they serve no agent run. */
  top: PartialSettings;
  profiled: { profile: Profile; settings: PartialSettings }[];
  /** The task's own provider, model and provider settings. */
  forTask: PartialSettings;
  /** The provider of the top level and of each profile. */
  providers: ProviderName[];
}

/**
 * Resolves the top level from the first layer that sets each value, then Codeman's defaults, and
 * each profile on it; checks them all. The layers are, in order: the task's commands, the
 * workflow inputs, the repository's settings file and the organization's (`LAYER_SOURCES`). The
 * list of profiles is one value: the first layer that has one gives it whole.
 *
 * A provider's settings go with it: a layer or a profile that names another provider than the
 * one it inherits leaves out the settings that were for that one, and must set its own model when
 * one would carry over. No setting is required: a top level without a model serves no agent run,
 * so a profile that inherits no model must set one.
 *
 * The top-level settings and every profile must fit their providers on their own, without the
 * task's commands, so that a mistake shows on the first run and not when a stage reaches it.
 */
function resolveLayers(layers: readonly SettingsLayer[]): Parsed<Resolved> {
  const [own = {}] = layers;
  const { profiles: list = [], ...values } = merge(layers);
  // The top level, as the layers the task's commands inherit set it; a task's model fills it only
  // when none of them sets one.
  const inherited = serving(
    layers.slice(1).map((settings, index) => ({
      name: layerSource(index + 1),
      source: LAYER_BASES[index + 1] ?? `layer ${index + 2}`,
      settings,
    })),
    { source: "Codeman's default", settings: { provider: DEFAULTS.provider } },
  );
  if (!inherited.ok) return inherited;
  const model = inherited.value.model ?? values.model;
  const top: PartialSettings = {
    ...omit(values, PROFILE_SETTINGS),
    ...inherited.value,
    ...(model === undefined ? {} : { model }),
  };
  const topError = settingsProblem(top);
  if (topError) return { ok: false, error: topError };
  const profiled: Resolved["profiled"] = [];
  for (const profile of list) {
    const name = `Profile \`${profile.name}\``;
    const served = serving([{ name, source: name, settings: profile.settings }], {
      source: "the top level",
      settings: top,
    });
    if (!served.ok) return served;
    const settings = { ...omit(top, PROFILE_SETTINGS), ...served.value };
    if (settings.model === undefined) {
      return {
        ok: false,
        error: `${name} has no \`model\`, and the top-level settings have none to inherit: set one in the profile.`,
      };
    }
    const error = settingsProblem(settings);
    if (error) return { ok: false, error: `${name}: ${error}` };
    profiled.push({ profile, settings });
  }

  const forTask = pick(own, PROFILE_SETTINGS);
  // A task's model is for the top level's provider: a profile on another one keeps its own.
  if (forTask.model !== undefined) {
    const error = settingsProblem({ ...top, model: forTask.model });
    if (error) {
      return {
        ok: false,
        error: `The task's \`model\` is for \`${top.provider}\`, the top-level settings' provider. ${error}`,
      };
    }
  }
  const providers = [top, ...profiled.map(({ settings }) => settings)].map(
    (settings) => settings.provider ?? DEFAULTS.provider,
  );
  for (const name of PROVIDER_SETTINGS) {
    if (forTask[name] !== undefined && !providers.some((p) => PROVIDERS[p].settings[name])) {
      return {
        ok: false,
        error: `No provider of the settings accepts \`${name}\`: they name ${[...new Set(providers)].map((p) => `\`${p}\``).join(", ")}.`,
      };
    }
  }
  return { ok: true, value: { top, profiled, forTask, providers } };
}

/**
 * What serves a run: the first profile whose conditions hold, else the top level when it has a
 * model; undefined when neither does.
 */
function servingRun(
  resolved: Resolved,
  run: RunConditions,
): { profile?: Profile; settings: PartialSettings } | undefined {
  const chosen = resolved.profiled.find(({ profile }) => applies(profile, run));
  if (chosen) return chosen;
  return resolved.top.model === undefined ? undefined : { settings: resolved.top };
}

/**
 * The settings of a run: the profile that serves it (the first whose conditions hold, with the
 * values it sets replacing the top level's, except those the task's own commands set), else the
 * top level. Without `run`, as for a run without an agent, the top level, whose model may be
 * empty. A task's own provider settings (`gpu`) apply to the runs whose provider accepts them,
 * and its model to the runs on the top level's provider.
 */
export function resolveRun(
  layers: readonly SettingsLayer[],
  run?: RunConditions,
): Parsed<RunSettings> {
  const resolved = resolveLayers(layers);
  if (!resolved.ok) return resolved;
  const { top, forTask, providers } = resolved.value;
  const served = run ? servingRun(resolved.value, run) : { settings: top };
  if (!served) {
    return {
      ok: false,
      error: `No settings apply to the \`${run?.stage}\` stage with ${run?.tasks} task(s): no profile does, and the top-level settings have no \`model\`.`,
    };
  }
  const base = served.settings;
  const accepted = PROVIDERS[base.provider ?? DEFAULTS.provider].settings;
  const taskServing = Object.fromEntries(
    Object.entries(forTask).filter(([name]) =>
      name === "model" ? base.provider === top.provider : name in accepted,
    ),
  );
  const settings = withProviderDefaults({ model: "", ...base, ...taskServing } as Settings);
  const error = settingsProblem(settings);
  if (error) {
    return {
      ok: false,
      error: served.profile ? `Profile \`${served.profile.name}\`: ${error}` : error,
    };
  }
  return {
    ok: true,
    value: {
      settings,
      profile: served.profile?.name,
      accounts: [...new Set(providers.map(accountOf))],
    },
  };
}

/** The top-level settings, as `resolveRun` resolves them for a run without an agent. */
export function resolveSettings(...layers: SettingsLayer[]): Parsed<Settings> {
  const resolved = resolveRun(layers);
  return resolved.ok ? { ok: true, value: resolved.value.settings } : resolved;
}

/** Whether all of a profile's conditions hold for a run. */
export function applies(profile: Profile, run: RunConditions): boolean {
  const { stages, tasks, "min-tasks": min, "max-tasks": max } = profile.conditions;
  return (
    (!stages || stages.includes(run.stage)) &&
    (tasks === undefined || run.tasks === tasks) &&
    (min === undefined || run.tasks >= min) &&
    (max === undefined || run.tasks <= max)
  );
}

/**
 * The most tasks one run works on at once, from the profiles' counts (decision 3 of the plan for
 * profiles that pick the tasks): the largest `tasks` or `max-tasks`; `min-tasks` without
 * `max-tasks` allows up to `MAX_TASKS`; with no count anywhere, one.
 */
export function tasksPerRun(layers: readonly SettingsLayer[]): number {
  const list = layers.find((layer) => layer.profiles !== undefined)?.profiles ?? [];
  let most = 1;
  for (const { conditions } of list) {
    const { tasks, "min-tasks": min, "max-tasks": max } = conditions;
    const named = tasks ?? max ?? (min === undefined ? undefined : MAX_TASKS);
    if (named !== undefined) most = Math.max(most, named);
  }
  return most;
}

/** A count of the run's tasks at which a stage is served, and the profile that serves it. */
export interface ServedCount {
  tasks: number;
  /** Undefined when the top level does. */
  profile?: string | undefined;
}

/**
 * The counts of the run's tasks, from 1 to `MAX_TASKS`, at which some profile or the top level
 * serves a stage, each with what serves it. Empty when nothing does at any count.
 */
export function servedCounts(
  layers: readonly SettingsLayer[],
  stage: Stage,
): Parsed<ServedCount[]> {
  const resolved = resolveLayers(layers);
  if (!resolved.ok) return resolved;
  const counts: ServedCount[] = [];
  for (let tasks = 1; tasks <= MAX_TASKS; tasks++) {
    const served = servingRun(resolved.value, { stage, tasks });
    if (served) counts.push({ tasks, profile: served.profile?.name });
  }
  return { ok: true, value: counts };
}

/** A layer of `serving`, and how its errors name it. */
interface NamedLayer {
  /** As the layer an error is about, capitalized. */
  name: string;
  /** As the base another layer inherits its provider from. */
  source: string;
  settings: PartialSettings;
}

/**
 * Where the model is served, from `layers` and `base` (the first layer wins; `base` is what the
 * last one inherits): the provider, the model, and the provider's settings. A layer that names
 * another provider than the one it inherits starts that provider's settings afresh (decision 2
 * of the provider settings plan), and must set its own model when one would carry over (the
 * model per provider plan). A block of settings, such as `ollama`, is inherited key by key: a
 * layer replaces the keys it sets, and keeps the others (choice 6 of the Ollama settings plan).
 */
function serving(
  layers: readonly NamedLayer[],
  base: Omit<NamedLayer, "name">,
): Parsed<PartialSettings> {
  let result: PartialSettings = pick(base.settings, PROFILE_SETTINGS);
  // The layer the provider so far comes from.
  let from = base.source;
  for (const { name, source, settings } of [...layers].reverse()) {
    const { provider } = settings;
    if (provider !== undefined && provider !== result.provider) {
      if (result.model !== undefined && settings.model === undefined) {
        return {
          ok: false,
          error: `${name} names \`${provider}\`, but inherits \`${result.provider}\` from ${from}, so it must set its own \`model\`, one for \`${provider}\`.`,
        };
      }
      result = omit(result, PROVIDER_KEYS);
    }
    if (provider !== undefined) from = source;
    const { ollama, ...values } = pick(settings, PROFILE_SETTINGS);
    Object.assign(result, values);
    if (ollama !== undefined) result.ollama = { ...result.ollama, ...ollama };
  }
  return { ok: true, value: result };
}

/** How errors name the layer at `index` of `resolveSettings`: where it comes from, capitalized. */
function layerSource(index: number): string {
  const source: string = LAYER_SOURCES[index] ?? `layer ${index + 1}`;
  return source.charAt(0).toUpperCase() + source.slice(1);
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

function pick(layer: PartialSettings, names: readonly string[]): PartialSettings {
  return Object.fromEntries(
    Object.entries(layer).filter(([name, value]) => value !== undefined && names.includes(name)),
  );
}

function omit<T extends PartialSettings>(layer: T, names: readonly string[]): T {
  return Object.fromEntries(Object.entries(layer).filter(([name]) => !names.includes(name))) as T;
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
      ? `[${value.map((profile: Profile) => profile.name).join(", ")}]`
      : typeof value === "object" && value !== null
        ? `{${Object.entries(value)
            .map(([key, text]) => `${key}: ${text}`)
            .join(", ")}}`
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

/**
 * Why settings do not fit their provider; undefined when they do. Settings without a model serve
 * no run, so only what their provider accepts is checked, not what it requires (choice 6 of the
 * plan for profiles that pick the tasks).
 */
function settingsProblem(settings: PartialSettings): string | undefined {
  const values = pick(settings, PROVIDER_SETTINGS) as Partial<Record<ProviderSettingName, string>>;
  const model = settings.model ?? "";
  return providerProblem(
    {
      ...values,
      ...(settings.ollama === undefined ? {} : { ollama: settings.ollama }),
      provider: settings.provider ?? DEFAULTS.provider,
      model,
    },
    model !== "",
  );
}
