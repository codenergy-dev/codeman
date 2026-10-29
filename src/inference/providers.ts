import { E2E } from "../e2e.ts";
import { ENGINES } from "./engines.ts";
import { HOST_KINDS, type HostKind, isHostKind } from "./gpu.ts";
import { type OllamaSettings, ollamaEnvironment } from "./ollama.ts";
import {
  isHuggingFaceId,
  TOOL_CALL_PARSER_NEEDED,
  type VllmSettings,
  vllmArguments,
} from "./vllm.ts";

/**
 * The providers a run's model can be served by, as the `provider` setting names them, and the
 * settings each accepts (decisions 1 to 3 of the provider settings plan). A new provider is a new
 * entry; validation, errors, the secrets `open-key` requires and the docs come from here. See
 * docs/settings/providers.md.
 */
export const PROVIDER_NAMES = ["openrouter", "runpod-pod", "runpod-serverless"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** The settings that only some providers accept; every provider takes `model`. */
export const PROVIDER_SETTINGS = [
  "engine",
  "gpu",
  "endpoint",
  "pod-reuse",
  "hosts",
  "priority",
] as const;
export type ProviderSettingName = (typeof PROVIDER_SETTINGS)[number];

/**
 * Blocks of settings that only some providers accept, each for one of their engines: `ollama`
 * (the Ollama settings plan) and `vllm` (the plan for vLLM on pods). Each key of a block is
 * inherited like a setting.
 */
export const PROVIDER_BLOCKS = ["ollama", "vllm"] as const;
export type ProviderBlockName = (typeof PROVIDER_BLOCKS)[number];

/** How a provider takes a block of settings. */
export interface ProviderBlock {
  /** The engine the block configures; the provider takes it only with that engine. */
  engine: string;
}

/**
 * Checks a whole block, inherited from every layer: throws with what is wrong, such as a key it
 * does not take or keys that do not go together.
 */
const BLOCK_CHECKS: Readonly<
  Record<ProviderBlockName, (settings: Readonly<Record<string, string>>) => unknown>
> = { ollama: ollamaEnvironment, vllm: vllmArguments };

/** The engine each block configures, whichever provider takes it. */
export const BLOCK_ENGINES: Readonly<Record<ProviderBlockName, string>> = {
  ollama: "ollama",
  vllm: "vllm",
};

/** How a provider takes one of its settings. */
export interface ProviderSetting {
  /** Whether a run on the provider needs it; such a setting has no default. */
  required?: boolean;
  /** The values the provider allows; any valid value when undefined. */
  values?: readonly string[];
  /**
   * Whether the setting is a list of those values, each once, in an order that matters, written
   * `a,b` (`listSetting`), such as `hosts`.
   */
  list?: boolean;
  /** Its value when no layer sets it. */
  default?: string;
  /** A value, for errors. */
  example?: string;
}

/** An account whose key opens a provider's runs, and whose billing the budgets read. */
export interface Account {
  /** The action's input that carries the account's key. */
  input: string;
  /** The secret the templates pass to it. */
  secret: string;
  /** Whether the account bills GPUs by the hour, which reconciles the organization's month. */
  hourly: boolean;
}

/** The accounts, by name: OpenRouter's, and Runpod's for pods and Serverless endpoints. */
export const ACCOUNTS: Readonly<Record<string, Account>> = {
  openrouter: {
    input: "management-key",
    secret: "CODEMAN_OPENROUTER_MANAGEMENT_KEY",
    hourly: false,
  },
  runpod: { input: "gpu-key", secret: "CODEMAN_RUNPOD_API_KEY", hourly: true },
};

export interface Provider {
  /** The account whose key opens its runs and whose billing counts them. */
  account: string;
  /** The settings it accepts beside `model`; any other stops the run. */
  settings: Readonly<Partial<Record<ProviderSettingName, ProviderSetting>>>;
  /** The blocks of settings it accepts; any other stops the run. */
  blocks?: Readonly<Partial<Record<ProviderBlockName, ProviderBlock>>>;
  /** What its model IDs are: OpenRouter's, or its engine's. */
  model: "openrouter" | "engine";
  /** Secrets beside its account's key, and the job that uses each. */
  secrets: readonly { secret: string; input: string; job: string }[];
}

export const PROVIDERS: Readonly<Record<ProviderName, Provider>> = {
  openrouter: { account: "openrouter", settings: {}, model: "openrouter", secrets: [] },
  "runpod-pod": {
    account: "runpod",
    settings: {
      engine: { values: ["ollama", "vllm"], default: "ollama" },
      gpu: { required: true, example: '"NVIDIA RTX A6000"' },
      "pod-reuse": { values: ["task", "run"], default: "task" },
      // Secure Cloud by default; Community Cloud only when the settings files allow it
      // (decisions 1 and 9 of the plan for Salad pods).
      hosts: { values: HOST_KINDS, default: "secure", list: true },
      // Runpod's REST API offers no interruptible pods (decision 2 of the plan for Salad pods).
      priority: { values: ["on-demand"], default: "on-demand" },
    },
    blocks: { ollama: { engine: "ollama" }, vllm: { engine: "vllm" } },
    model: "engine",
    secrets: [],
  },
  "runpod-serverless": {
    account: "runpod",
    settings: {
      engine: { values: ["vllm"], default: "vllm" },
      endpoint: { required: true, example: "abc123xyz" },
    },
    model: "engine",
    // The endpoint's key, restricted to it: only the agent job's gateway holds it.
    secrets: [{ secret: "CODEMAN_RUNPOD_SERVERLESS_KEY", input: "serverless-key", job: "agent" }],
  },
};

export function isProviderName(name: string): name is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(name);
}

export function isProviderSetting(name: string): name is ProviderSettingName {
  return (PROVIDER_SETTINGS as readonly string[]).includes(name);
}

export function isProviderBlock(name: string): name is ProviderBlockName {
  return (PROVIDER_BLOCKS as readonly string[]).includes(name);
}

/**
 * The account of a provider. Ledger documents written before providers name the account itself
 * (`openrouter` or `runpod`), which reads as it is.
 */
export function accountOf(provider: string): string {
  return isProviderName(provider) ? PROVIDERS[provider].account : provider;
}

/** Whether an account bills GPUs by the hour; unknown accounts do not. */
export function isHourlyAccount(name: string): boolean {
  return ACCOUNTS[name]?.hourly ?? false;
}

/** Every value some provider allows for a setting, for parsing it before its provider is known. */
export function settingValues(name: ProviderSettingName): string[] | undefined {
  const values = Object.values(PROVIDERS).flatMap(
    (provider) => provider.settings[name]?.values ?? [],
  );
  return values.length > 0 ? [...new Set(values)] : undefined;
}

/** The settings of one run on a provider, as `providerProblem` checks them. */
export type ProviderSettings = { provider: string; model: string } & Partial<
  Record<ProviderSettingName, string>
> & { ollama?: OllamaSettings | undefined; vllm?: VllmSettings | undefined };

/**
 * Why settings do not fit their provider: a setting it does not accept, a value it does not
 * offer, a required setting missing, or a model that is not one of its model IDs. Undefined when
 * they fit. Defaults are not needed: a missing setting with one is fine. Settings that serve no
 * run (`serves` false), such as a top level without a model, are checked only for what the
 * provider accepts: neither its required settings nor the model.
 */
export function providerProblem(settings: ProviderSettings, serves = true): string | undefined {
  const name = settings.provider;
  if (!isProviderName(name)) return `Unknown provider \`${name}\`.`;
  const provider = PROVIDERS[name];
  for (const setting of [...PROVIDER_SETTINGS, ...PROVIDER_BLOCKS]) {
    const accepted = isProviderBlock(setting)
      ? provider.blocks?.[setting]
      : provider.settings[setting];
    if (settings[setting] !== undefined && !accepted) {
      return `\`${name}\` does not accept \`${setting}\`; ${acceptedText(name)}`;
    }
  }
  for (const setting of PROVIDER_SETTINGS) {
    const spec = provider.settings[setting];
    const value = settings[setting];
    if (!spec) continue;
    if (value === undefined) {
      if (spec.required && serves) {
        return `\`${name}\` needs \`${setting}\`${spec.example ? `, such as \`${spec.example}\`` : ""}.`;
      }
      continue;
    }
    if (spec.list && spec.values) {
      const parsed = listSetting(setting, value, spec.values);
      if (!parsed.ok) return `With \`${name}\`, ${parsed.error}`;
      continue;
    }
    if (spec.values && !spec.values.includes(value)) {
      const offered = spec.values.map((v) => `\`${v}\``).join(", ");
      return setting === "engine"
        ? `\`${name}\` does not offer the engine \`${value}\`; it offers ${offered}.`
        : `With \`${name}\`, \`${setting}\` must be one of ${offered}, not \`${value}\`.`;
    }
  }
  const engine = settings.engine ?? provider.settings.engine?.default;
  for (const block of PROVIDER_BLOCKS) {
    const spec = provider.blocks?.[block];
    if (!spec || settings[block] === undefined) continue;
    if (engine !== spec.engine) {
      return `With \`${name}\`, \`${block}\` configures the engine \`${spec.engine}\`, not \`${engine}\`.`;
    }
    try {
      BLOCK_CHECKS[block](settings[block] ?? {});
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  if (!serves) return undefined;
  // A pod's vLLM serves tool calls only with the model's parser (decision 5 of the plan for vLLM
  // on pods).
  if (provider.blocks?.vllm && engine === "vllm" && !settings.vllm?.["tool-call-parser"]) {
    return TOOL_CALL_PARSER_NEEDED;
  }
  return modelProblem(name, settings.model, settings.engine);
}

/**
 * A list setting's value, from `a,b` or `[a, b]`: each of `values`, once, at least one; given
 * back as `a,b`, the form settings keep it in.
 */
export function listSetting(
  name: string,
  text: string,
  values: readonly string[],
): { ok: true; value: string } | { ok: false; error: string } {
  const items = text
    .replace(/^\[(.*)\]$/, "$1")
    .split(",")
    .map((item) => item.trim());
  const offered = values.map((value) => `\`${value}\``).join(", ");
  if (items.some((item) => !values.includes(item))) {
    return {
      ok: false,
      error: `\`${name}\` must list some of ${offered}, each once, such as \`[${values.join(", ")}]\`.`,
    };
  }
  if (new Set(items).size !== items.length) {
    return { ok: false, error: `\`${name}\` lists a value twice: list each of ${offered} once.` };
  }
  return { ok: true, value: items.join(",") };
}

/** The kinds of host a `hosts` value lists, by preference; the default's when undefined. */
export function hostKinds(hosts: string | undefined): HostKind[] {
  return (hosts ?? "secure").split(",").filter(isHostKind);
}

/** The settings with the provider's defaults for those no layer set. */
export function withProviderDefaults<T extends ProviderSettings>(settings: T): T {
  const provider = isProviderName(settings.provider) ? PROVIDERS[settings.provider] : undefined;
  const filled: T = { ...settings };
  for (const [setting, spec] of Object.entries(provider?.settings ?? {})) {
    if (spec.default !== undefined && filled[setting as ProviderSettingName] === undefined) {
      Object.assign(filled, { [setting]: spec.default });
    }
  }
  return filled;
}

/** `it takes only `model`.`, or the settings it takes beside it. */
function acceptedText(name: ProviderName): string {
  const { settings, blocks = {} } = PROVIDERS[name];
  const accepted = [...Object.keys(settings), ...Object.keys(blocks)].map(
    (setting) => `\`${setting}\``,
  );
  return accepted.length === 0
    ? "it takes only `model`."
    : `besides \`model\`, it takes ${list(accepted)}.`;
}

function list(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function modelProblem(
  name: ProviderName,
  model: string,
  engine: string | undefined,
): string | undefined {
  const provider = PROVIDERS[name];
  if (provider.model === "openrouter") {
    return isOpenRouterModel(model)
      ? undefined
      : `With \`${name}\`, \`model\` must be an OpenRouter model ID, such as \`provider/model\`, not \`${model}\`.`;
  }
  const engineName = engine ?? provider.settings.engine?.default ?? "";
  const served = ENGINES[engineName];
  if (!served) return `\`${name}\` has no engine \`${engineName}\`.`;
  // vLLM downloads a pod's model from Hugging Face (decision 10 of the plan for vLLM on pods).
  if (provider.blocks?.vllm && engineName === "vllm") {
    return isHuggingFaceId(model)
      ? undefined
      : `With \`${name}\` and the engine \`vllm\`, \`model\` must be a Hugging Face model ID, \`namespace/name\`, such as \`${served.example}\`, not \`${model}\`.`;
  }
  return served.isModel(model)
    ? undefined
    : `With \`${name}\`, \`model\` must be a model name of the engine \`${engineName}\`, such as \`${served.example}\`, not \`${model}\`.`;
}

/** OpenRouter model IDs, such as `deepseek/deepseek-v4.1-flash` or `~deepseek/deepseek-flash-latest`. */
const OPENROUTER_MODEL = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isOpenRouterModel(text: string): boolean {
  return text.length <= 100 && OPENROUTER_MODEL.test(text);
}

/** Runpod's Serverless endpoint IDs. */
const ENDPOINT_ID = /^[a-z0-9]{1,64}$/i;
/** The only origin whose endpoint URLs Codeman takes: the endpoint's key goes there. */
const RUNPOD_API = E2E?.endpoints.runpodServerless ?? "https://api.runpod.ai";

/**
 * A Serverless endpoint's ID, from the ID itself or a URL of the endpoint from Runpod's console
 * (`https://api.runpod.ai/v2/<id>/...`), whose path gives it (decision 5 of the plan).
 */
export function endpointId(
  text: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (ENDPOINT_ID.test(text)) return { ok: true, value: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      ok: false,
      error: `\`endpoint\` must be an endpoint's ID, letters and digits, or its URL, such as \`${RUNPOD_API}/v2/abc123xyz/run\`.`,
    };
  }
  if (url.origin !== RUNPOD_API) {
    return {
      ok: false,
      error: `\`endpoint\` takes only URLs of \`${RUNPOD_API}\`, where the endpoint's key goes, not \`${url.protocol}//${url.host}\`.`,
    };
  }
  const [, version, id = ""] = url.pathname.split("/");
  if (url.username || url.password || version !== "v2" || !ENDPOINT_ID.test(id)) {
    return {
      ok: false,
      error: `\`endpoint\`'s URL must be the endpoint's, such as \`${RUNPOD_API}/v2/abc123xyz/run\`.`,
    };
  }
  return { ok: true, value: id };
}
