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
};

/** Settings a maintainer can change for one task with `/codeman set`. */
export const TASK_SETTINGS: ReadonlySet<SettingName> = new Set([
  "model",
  "task-budget",
  "max-runs",
]);

const NAMES: readonly SettingName[] = [
  "model",
  "task-budget",
  "monthly-budget",
  "max-runs",
  "max-files",
  "max-file-bytes",
];

/** OpenRouter model IDs, such as `deepseek/deepseek-v4.1-flash` or `~deepseek/deepseek-flash-latest`. */
const MODEL_ID = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isModelId(text: string): boolean {
  return text.length <= 100 && MODEL_ID.test(text);
}

export function isSettingName(name: string): name is SettingName {
  return (NAMES as readonly string[]).includes(name);
}

/** Validates one value, given as text. */
export function parseSetting(name: SettingName, text: string): Parsed<string | number> {
  if (name === "model") {
    return isModelId(text)
      ? { ok: true, value: text }
      : {
          ok: false,
          error: `\`${name}\` must be an OpenRouter model ID, such as \`provider/model\`.`,
        };
  }
  const value = Number(text);
  const integer = name !== "task-budget" && name !== "monthly-budget";
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
  return { ok: true, value: merged as Settings };
}
