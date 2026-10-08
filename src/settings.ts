import { ENGINES } from "./inference/engines.ts";
import {
  accountOf,
  endpointId,
  isOpenRouterModel,
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
  /**
   * Where agent runs get their model: `openrouter`, `runpod-pod` or `runpod-serverless`. The
   * settings below it are accepted only by some providers (`src/inference/providers.ts`).
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
  /** How many tasks one run works on at once, each in its own jobs. */
  "parallel-tasks": number;
}

export type SettingName = keyof Settings;
export type PartialSettings = Partial<Settings>;

/** Codeman's own defaults. There is no default model (see docs/settings/reference.md). */
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
  "parallel-tasks",
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
export const PROFILE_SETTINGS: readonly SettingName[] = ["provider", "model", ...PROVIDER_SETTINGS];

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

/** What a profile's `stages` condition names: planning, routing, and each stage. */
export const PROFILE_STAGES = ["plan", "route", ...STAGES] as const;
export type ProfileStage = (typeof PROFILE_STAGES)[number];

/**
 * A rule that picks a provider, a model and that provider's settings for some runs: the first
 * profile whose conditions all hold applies.
 */
export interface Profile {
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
    const parsed = entry.key === "profiles" ? profiles(entry.value) : setting(entry, "setting");
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
  const renamed = renamedSetting(name, value.kind === "scalar" ? value.text : undefined);
  if (renamed) return { ok: false, line, error: renamed };
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
  const result: Profile = { name: "", when: {}, settings: {} };
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

function conditions(entry: YamlEntry): Read<Profile["when"]> {
  const { line, value } = entry;
  if (value.kind !== "map") {
    return { ok: false, line, error: "`when` must be a block of conditions." };
  }
  const when: Profile["when"] = {};
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

/**
 * Resolves each setting from the first layer that sets it, then Codeman's defaults. The layers
 * are, in order: the task's commands, the workflow inputs, the repository's settings file and
 * the organization's (`LAYER_SOURCES`). The list of profiles is one value: the first layer that
 * has one gives it whole. Then, for a run, the first profile whose conditions hold replaces the
 * top-level values it sets, except those the task's own commands (the first layer) set.
 *
 * A provider's settings go with it: a layer or a profile that names another provider than the
 * one below it leaves out the settings that were for that one, and must set its own model when
 * one would carry over. A task's own provider settings (`gpu`) apply to the runs whose provider
 * accepts them, and its model to the runs on the top level's provider.
 *
 * The top-level settings and every profile must fit their providers on their own, without the
 * task's commands, so that a mistake shows on the first run and not when a stage reaches it.
 */
export function resolveRun(
  layers: readonly SettingsLayer[],
  run?: RunConditions,
): Parsed<RunSettings> {
  const [own = {}] = layers;
  const { profiles: list = [], ...values } = merge(layers);
  if (values.model === undefined) {
    return {
      ok: false,
      error: `No model is configured. Set \`model\` in ${SETTINGS_FILE} or in the workflow's inputs.`,
    };
  }
  // The top level as the layers below the task's commands set it; a task's model fills it only
  // when none of them sets one.
  const below = serving(
    layers.slice(1).map((settings, index) => ({ name: layerSource(index + 1), settings })),
    { provider: DEFAULTS.provider },
  );
  if (!below.ok) return below;
  const top = {
    ...omit(values, PROFILE_SETTINGS),
    ...below.value,
    model: below.value.model ?? values.model,
  };
  const topError = settingsProblem(top);
  if (topError) return { ok: false, error: topError };
  const profiled: { profile: Profile; settings: PartialSettings }[] = [];
  for (const profile of list) {
    const name = `Profile \`${profile.name}\``;
    const served = serving([{ name, settings: profile.settings }], top);
    if (!served.ok) return served;
    const settings = { ...omit(top, PROFILE_SETTINGS), ...served.value };
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
  const chosen = run ? profiled.find(({ profile }) => applies(profile, run)) : undefined;
  const base = chosen?.settings ?? top;
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
  const accepted = PROVIDERS[base.provider ?? DEFAULTS.provider].settings;
  const taskServing = Object.fromEntries(
    Object.entries(forTask).filter(([name]) =>
      name === "model" ? base.provider === top.provider : name in accepted,
    ),
  );
  const settings = withProviderDefaults({ ...base, ...taskServing } as Settings);
  const error = settingsProblem(settings);
  if (error) {
    return { ok: false, error: chosen ? `Profile \`${chosen.profile.name}\`: ${error}` : error };
  }
  return {
    ok: true,
    value: {
      settings,
      profile: chosen?.profile.name,
      accounts: [...new Set(providers.map(accountOf))],
    },
  };
}

/** The top-level settings, as `resolveRun` resolves them when no profile applies. */
export function resolveSettings(...layers: SettingsLayer[]): Parsed<Settings> {
  const resolved = resolveRun(layers);
  return resolved.ok ? { ok: true, value: resolved.value.settings } : resolved;
}

/** Whether all of a profile's conditions hold for a run. */
export function applies(profile: Profile, run: RunConditions): boolean {
  const { stages, "parallel-tasks": tasks } = profile.when;
  return (!stages || stages.includes(run.stage)) && (tasks === undefined || run.tasks >= tasks);
}

/** A layer of `serving`, and how its errors name it. */
interface NamedLayer {
  name: string;
  settings: PartialSettings;
}

/**
 * Where the model is served, from `layers` over `base` (the first layer wins): the provider, the
 * model, and the provider's settings. A layer that names another provider than the one below it
 * starts that provider's settings afresh (decision 2 of the provider settings plan), and must set
 * its own model when one would carry over (the model per provider plan).
 */
function serving(layers: readonly NamedLayer[], base: PartialSettings): Parsed<PartialSettings> {
  let result: PartialSettings = pick(base, PROFILE_SETTINGS);
  for (const { name, settings } of [...layers].reverse()) {
    const { provider } = settings;
    if (provider !== undefined && provider !== result.provider) {
      if (result.model !== undefined && settings.model === undefined) {
        return {
          ok: false,
          error: `${name} names \`${provider}\`, another provider than the \`${result.provider}\` below it, so it must set its own \`model\`, one for \`${provider}\`.`,
        };
      }
      result = omit(result, PROVIDER_SETTINGS);
    }
    Object.assign(result, pick(settings, PROFILE_SETTINGS));
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

/** Why settings do not fit their provider; undefined when they do. */
function settingsProblem(settings: PartialSettings): string | undefined {
  const values = pick(settings, PROVIDER_SETTINGS) as Partial<Record<ProviderSettingName, string>>;
  return providerProblem({
    ...values,
    provider: settings.provider ?? DEFAULTS.provider,
    model: settings.model ?? "",
  });
}
