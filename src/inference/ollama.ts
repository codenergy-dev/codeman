import { type InferenceEngine, openAiUsage } from "./engine.ts";

/**
 * Codeman's pod image: Ollama, Node and the gateway, built by `.github/workflows/pod-image.yml`
 * from `docker/pod/Dockerfile` and referenced by digest. Published from 5e733d1; pin a new
 * digest whenever the Dockerfile or `dist/gateway.js` changes. The `pod-image` input overrides
 * it. See docs/installation/runpod.md#pods.
 */
export const POD_IMAGE =
  "ghcr.io/codenergy-dev/codeman-pod@sha256:3252d41775a230249490b5af79aec050151e49c4722bb62f9ce3d247d02f6ca3";

/**
 * Pod images whose gateway serves one run at a time, as before parallel tasks: Codeman gives each
 * task a pod of its own on them, instead of sharing one. Keep each image pinned before.
 */
export const SINGLE_RUN_IMAGES: ReadonlySet<string> = new Set([
  "ghcr.io/codenergy-dev/codeman-pod@sha256:6a7617fc8772c43600349a971a424bc918982c6d38972e7d1802a1a607e76d27",
]);

/**
 * Pod images whose gateway cannot apply Ollama settings: Codeman refuses them, before creating a
 * pod, for a run that has some. Keep each image pinned before Ollama settings (plan of
 * 2026-10-08, choice 8). See docs/settings/ollama.md#pod-images.
 */
export const IMAGES_WITHOUT_OLLAMA_SETTINGS: ReadonlySet<string> = new Set([
  ...SINGLE_RUN_IMAGES,
  "ghcr.io/codenergy-dev/codeman-pod@sha256:3252d41775a230249490b5af79aec050151e49c4722bb62f9ce3d247d02f6ca3",
]);

/** Where Ollama listens inside the pod: its loopback, behind the gateway. */
export const OLLAMA_URL = "http://127.0.0.1:11434";

/** The Ollama of the pod image (`docker/pod/Dockerfile`), whose variables `OLLAMA_SETTINGS` lists. */
export const OLLAMA_VERSION = "0.35.1";

/** What an Ollama setting's value is. */
export type OllamaValue =
  | { kind: "count"; min: number }
  | { kind: "boolean" }
  | { kind: "choice"; values: readonly string[] }
  | { kind: "duration" };

export interface OllamaSetting {
  /** The server's environment variable. */
  variable: string;
  value: OllamaValue;
}

/**
 * The Ollama settings a pod takes, in the `ollama` block of `runpod-pod`, by their key in the
 * settings file: the variables of `OLLAMA_VERSION`'s server (`envconfig`, docs/web/ollama/) that
 * tune how it serves the pod's model. Any other key stops the run (decision 2 of the Ollama
 * settings plan). docs/settings/ollama.md documents the same list, and a test checks it.
 */
export const OLLAMA_SETTINGS: Readonly<Record<string, OllamaSetting>> = {
  "context-length": { variable: "OLLAMA_CONTEXT_LENGTH", value: { kind: "count", min: 1 } },
  "num-parallel": { variable: "OLLAMA_NUM_PARALLEL", value: { kind: "count", min: 1 } },
  "max-queue": { variable: "OLLAMA_MAX_QUEUE", value: { kind: "count", min: 1 } },
  "flash-attention": { variable: "OLLAMA_FLASH_ATTENTION", value: { kind: "boolean" } },
  "kv-cache-type": {
    variable: "OLLAMA_KV_CACHE_TYPE",
    value: { kind: "choice", values: ["f16", "q8_0", "q4_0"] },
  },
  "gpu-overhead": { variable: "OLLAMA_GPU_OVERHEAD", value: { kind: "count", min: 0 } },
  "sched-spread": { variable: "OLLAMA_SCHED_SPREAD", value: { kind: "boolean" } },
  "load-timeout": { variable: "OLLAMA_LOAD_TIMEOUT", value: { kind: "duration" } },
};

/**
 * Ollama's variables that Codeman controls, by their key, and why: setting them would break the
 * gateway's guarantees (Ollama only on the pod's loopback, behind the gateway; the model kept
 * loaded) or expose the runs' requests.
 */
export const REFUSED_OLLAMA_SETTINGS: Readonly<Record<string, string>> = {
  host: "Codeman runs Ollama on the pod's loopback, where only its gateway reaches it",
  origins: "only Codeman's gateway calls Ollama, from the pod's loopback",
  "keep-alive": "Codeman keeps the model loaded for as long as the pod lives",
  models: "Codeman pulls the model where the pod image keeps models, on the disk it sizes for it",
  remotes: "remote models would send the runs' requests off the pod",
  "debug-log-requests":
    "it writes the runs' requests, with the repository's code in them, to the pod's disk",
};

/** Go durations (`10m`, `1h30m`, `90s`) or whole seconds, as Ollama reads `OLLAMA_LOAD_TIMEOUT`. */
const DURATION = /^(?:[0-9]+|(?:[0-9]+(?:\.[0-9]+)?(?:h|m|s|ms))+)$/;

/** The key of the file for a key written as Ollama's variable, such as `OLLAMA_NUM_PARALLEL`. */
function keyOf(written: string): string {
  return written
    .toLowerCase()
    .replace(/^ollama_/, "")
    .replaceAll("_", "-");
}

/**
 * Checks one key of the `ollama` block and its value, written as text; gives the value as Ollama
 * takes it, such as `4` for `04`.
 */
export function ollamaSetting(
  key: string,
  text: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const setting = OLLAMA_SETTINGS[key];
  if (!setting) {
    const kebab = keyOf(key);
    const refused = REFUSED_OLLAMA_SETTINGS[kebab];
    if (refused) return fail(`\`ollama\` cannot set \`${kebab}\`: ${refused}.`);
    if (kebab !== key && OLLAMA_SETTINGS[kebab]) {
      return fail(
        `\`ollama\` takes its keys in kebab-case, without \`OLLAMA_\`: write \`${kebab}\`, not \`${key}\`.`,
      );
    }
    return fail(
      `\`ollama\` does not accept \`${key}\`; it takes ${list(Object.keys(OLLAMA_SETTINGS).map((name) => `\`${name}\``))} (docs/settings/ollama.md).`,
    );
  }
  const { value } = setting;
  switch (value.kind) {
    case "count": {
      const number = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
      return Number.isSafeInteger(number) && number >= value.min
        ? { ok: true, value: String(number) }
        : fail(`\`ollama\`'s \`${key}\` must be a whole number, at least ${value.min}.`);
    }
    case "boolean":
      return text === "true" || text === "false"
        ? { ok: true, value: text }
        : fail(`\`ollama\`'s \`${key}\` must be \`true\` or \`false\`.`);
    case "choice":
      return value.values.includes(text)
        ? { ok: true, value: text }
        : fail(
            `\`ollama\`'s \`${key}\` must be one of ${value.values.map((v) => `\`${v}\``).join(", ")}.`,
          );
    case "duration":
      return DURATION.test(text)
        ? { ok: true, value: text }
        : fail(
            `\`ollama\`'s \`${key}\` must be a duration, such as \`10m\` or \`1h30m\`, or whole seconds.`,
          );
  }
}

/** Ollama settings, by key, with their values; an empty block is none. */
export type OllamaSettings = Readonly<Record<string, string>>;

/**
 * The server's environment for Ollama settings, such as `{ OLLAMA_NUM_PARALLEL: "4" }`, sorted
 * by variable. Throws on a key or value `ollamaSetting` refuses.
 */
export function ollamaEnvironment(settings: OllamaSettings | undefined): Record<string, string> {
  const entries = Object.entries(settings ?? {}).map(([key, text]) => {
    const checked = ollamaSetting(key, text);
    if (!checked.ok) throw new Error(checked.error);
    return [OLLAMA_SETTINGS[key]?.variable ?? key, checked.value] as const;
  });
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The Ollama variables a pod's `CODEMAN_OLLAMA` gives, as JSON; none when it is unset. Only the
 * variables of `OLLAMA_SETTINGS`, with valid values: the gateway never lets one replace those it
 * sets itself.
 */
export function parseOllamaVariables(
  text: string | undefined,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (text === undefined || text.trim() === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "CODEMAN_OLLAMA is not JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "CODEMAN_OLLAMA is not an object of variables." };
  }
  const byVariable = new Map(
    Object.entries(OLLAMA_SETTINGS).map(([key, { variable }]) => [variable, key]),
  );
  const variables: Record<string, string> = {};
  for (const [variable, value] of Object.entries(parsed)) {
    const key = byVariable.get(variable);
    if (!key || typeof value !== "string") {
      return { ok: false, error: `CODEMAN_OLLAMA sets \`${variable}\`, which Codeman does not.` };
    }
    const checked = ollamaSetting(key, value);
    if (!checked.ok) return { ok: false, error: `CODEMAN_OLLAMA: ${checked.error}` };
    variables[variable] = checked.value;
  }
  return { ok: true, value: variables };
}

function list(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Ollama model names: `name[:tag]`, optionally after a namespace or registry, such as `qwen3-coder:30b`. */
const MODEL = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,2}(:[a-z0-9][a-z0-9._-]*)?$/i;

/**
 * Ollama, on a pod. Its OpenAI-compatible API reports `usage`, in streams too when asked (see
 * docs/web/ollama/openai-compatibility.md). Whether its `prompt_tokens` counts the prompt it
 * reused from its cache is checked in step 8 of the self-hosted inference plan.
 */
export const ollama: InferenceEngine = {
  name: "ollama",
  example: "qwen3-coder:30b",
  isModel: (model) => model.length <= 100 && MODEL.test(model),
  usage: (body) => openAiUsage(body),
};

/**
 * The model's own context length, from `POST /api/show`: the `<architecture>.context_length` of
 * its `model_info`. See docs/web/ollama/show-model-details.md.
 */
export function ollamaContextLength(show: unknown): number | undefined {
  const info = (show as { model_info?: Record<string, unknown> } | null)?.model_info;
  if (typeof info !== "object" || info === null) return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number" && value > 0) return value;
  }
  return undefined;
}
