import { ENGINES, MODE_ENGINE } from "./inference/engines.ts";
import type { Parsed } from "./output.ts";

export const SETTINGS_FILE = ".codeman/settings.yml";

/** Values a repository can configure. Names match the workflow inputs. */
export interface Settings {
  model: string;
  "task-budget": number;
  "monthly-budget": number;
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
};

/**
 * Bounds of the output limits. They keep what the agent writes within a comment of 65,536
 * characters, GitHub's limit.
 */
export const LIMIT_BOUNDS: Readonly<Partial<Record<SettingName, { min: number; max: number }>>> = {
  "max-decisions": { min: 1, max: 10 },
  "max-options": { min: 2, max: 6 },
  "max-title-chars": { min: 1, max: 200 },
  "max-question-chars": { min: 1, max: 1500 },
  "max-label-chars": { min: 1, max: 300 },
  "max-summary-chars": { min: 1, max: 4000 },
};

/** Settings a maintainer can change for one task with `/codeman set`. */
export const TASK_SETTINGS: ReadonlySet<SettingName> = new Set([
  "model",
  "task-budget",
  "max-runs",
  "language",
  "gpu-type",
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
  return name === "task-budget" || name === "monthly-budget" ? "number" : "integer";
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

/**
 * Reads `.codeman/settings.yml`. Only a flat subset of YAML is accepted: `name: value` lines,
 * blank lines and `#` comments, with values optionally in quotes. Anything else is an error,
 * so the file never means something different from what it looks like.
 */
export function parseSettings(text: string): Parsed<PartialSettings> {
  const settings: Record<string, string | number> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const where = `${SETTINGS_FILE}, line ${index + 1}`;
    const line = raw.trimEnd();
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const match = /^([a-z-]+):(?:\s+(.*))?$/.exec(line);
    if (!match?.[1]) return { ok: false, error: `${where}: expected \`name: value\`.` };
    const name = match[1];
    if (!isSettingName(name)) return { ok: false, error: `${where}: unknown setting \`${name}\`.` };
    if (name in settings) return { ok: false, error: `${where}: \`${name}\` appears twice.` };
    const value = scalar(match[2] ?? "");
    if (value === undefined)
      return { ok: false, error: `${where}: the value of \`${name}\` is not a plain value.` };
    const parsed = parseSetting(name, value);
    if (!parsed.ok) return { ok: false, error: `${where}: ${parsed.error}` };
    settings[name] = parsed.value;
  }
  return { ok: true, value: settings as PartialSettings };
}

/** A plain or quoted scalar with an optional trailing comment; undefined for anything else. */
function scalar(text: string): string | undefined {
  const quoted = /^(["'])([^"'\\]*)\1\s*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[2];
  const plain = text.replace(/\s+#.*$/, "").trim();
  return /^[A-Za-z0-9._~/:-]*$/.test(plain) ? plain : undefined;
}

/**
 * Resolves each setting from, in order: the task's commands, the workflow inputs, the
 * repository's settings file and Codeman's defaults.
 */
export function resolveSettings(...layers: PartialSettings[]): Parsed<Settings> {
  const merged: PartialSettings = { ...DEFAULTS };
  for (const layer of [...layers].reverse()) {
    for (const [name, value] of Object.entries(layer)) {
      if (value !== undefined) Object.assign(merged, { [name]: value });
    }
  }
  if (merged.model === undefined) {
    return {
      ok: false,
      error: `No model is configured. Set \`model\` in ${SETTINGS_FILE} or in the workflow's inputs.`,
    };
  }
  const settings = merged as Settings;
  const error = inferenceError(settings);
  if (error) return { ok: false, error };
  if (settings.inference === "self-hosted") {
    settings.engine ??= MODE_ENGINE[settings["gpu-mode"] as keyof typeof MODE_ENGINE];
  }
  return { ok: true, value: settings };
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
