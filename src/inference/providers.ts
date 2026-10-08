import { ENGINES } from "./engines.ts";

/**
 * The providers a run's model can be served by, as the `provider` setting names them, and the
 * settings each accepts (decisions 1 to 3 of the provider settings plan). A new provider is a new
 * entry; validation, errors, the secrets `open-key` requires and the docs come from here. See
 * docs/architecture.md#providers.
 */
export const PROVIDER_NAMES = ["openrouter", "runpod-pod", "runpod-serverless"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** The settings that only some providers accept; every provider takes `model`. */
export const PROVIDER_SETTINGS = ["engine", "gpu", "endpoint", "pod-reuse"] as const;
export type ProviderSettingName = (typeof PROVIDER_SETTINGS)[number];

/** How a provider takes one of its settings. */
export interface ProviderSetting {
  /** Whether a run on the provider needs it; such a setting has no default. */
  required?: boolean;
  /** The values the provider allows; any valid value when undefined. */
  values?: readonly string[];
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
      engine: { values: ["ollama"], default: "ollama" },
      gpu: { required: true, example: '"NVIDIA RTX A6000"' },
      "pod-reuse": { values: ["task", "run"], default: "task" },
    },
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
>;

/**
 * Why settings do not fit their provider: a setting it does not accept, a value it does not
 * offer, a required setting missing, or a model that is not one of its model IDs. Undefined when
 * they fit. Defaults are not needed: a missing setting with one is fine.
 */
export function providerProblem(settings: ProviderSettings): string | undefined {
  const name = settings.provider;
  if (!isProviderName(name)) return `Unknown provider \`${name}\`.`;
  const provider = PROVIDERS[name];
  for (const setting of PROVIDER_SETTINGS) {
    if (settings[setting] !== undefined && !provider.settings[setting]) {
      return `\`${name}\` does not accept \`${setting}\`; ${acceptedText(name)}`;
    }
  }
  for (const setting of PROVIDER_SETTINGS) {
    const spec = provider.settings[setting];
    const value = settings[setting];
    if (!spec) continue;
    if (value === undefined) {
      if (spec.required) {
        return `\`${name}\` needs \`${setting}\`${spec.example ? `, such as \`${spec.example}\`` : ""}.`;
      }
      continue;
    }
    if (spec.values && !spec.values.includes(value)) {
      const offered = spec.values.map((v) => `\`${v}\``).join(", ");
      return setting === "engine"
        ? `\`${name}\` does not offer the engine \`${value}\`; it offers ${offered}.`
        : `With \`${name}\`, \`${setting}\` must be one of ${offered}, not \`${value}\`.`;
    }
  }
  return modelProblem(name, settings.model, settings.engine);
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
  const accepted = Object.keys(PROVIDERS[name].settings).map((setting) => `\`${setting}\``);
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
/** The only host whose endpoint URLs Codeman takes: the endpoint's key goes there. */
const RUNPOD_API_HOST = "api.runpod.ai";

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
      error: `\`endpoint\` must be an endpoint's ID, letters and digits, or its URL, such as \`https://${RUNPOD_API_HOST}/v2/abc123xyz/run\`.`,
    };
  }
  if (url.protocol !== "https:" || url.hostname !== RUNPOD_API_HOST || url.port !== "") {
    return {
      ok: false,
      error: `\`endpoint\` takes only URLs of \`https://${RUNPOD_API_HOST}\`, where the endpoint's key goes, not \`${url.protocol}//${url.host}\`.`,
    };
  }
  const [, version, id = ""] = url.pathname.split("/");
  if (url.username || url.password || version !== "v2" || !ENDPOINT_ID.test(id)) {
    return {
      ok: false,
      error: `\`endpoint\`'s URL must be the endpoint's, such as \`https://${RUNPOD_API_HOST}/v2/abc123xyz/run\`.`,
    };
  }
  return { ok: true, value: id };
}
