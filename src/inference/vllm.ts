import { type InferenceEngine, openAiUsage } from "./engine.ts";

/** Hugging Face IDs, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`, or a served name without `/`. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/**
 * vLLM: on Runpod's Serverless worker, configured by the endpoint's environment
 * (docs/web/runpod/vllm-environment-variables.md), and on pods, by the `vllm` settings.
 */
export const vllm: InferenceEngine = {
  name: "vllm",
  example: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  isModel: (model) => model.length <= 100 && MODEL.test(model),
  usage: (body) => openAiUsage(body),
};

/** A Hugging Face repository's name: letters, digits, `.`, `_` and `-`, not at either end. */
const HUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;

/**
 * Whether `text` is a Hugging Face model ID, `namespace/name`, such as `unsloth/Qwen3.8-27B-NVFP4`:
 * what vLLM downloads on a pod (decision 10 of the plan for vLLM on pods).
 */
export function isHuggingFaceId(text: string): boolean {
  const [namespace = "", name = "", ...rest] = text.split("/");
  return (
    rest.length === 0 &&
    [namespace, name].every((part) => HUB_NAME.test(part) && !/--|\.\./.test(part))
  );
}

/** The names the worker answers to: its served name, if overridden, and its model. */
export function servedModels(env: Record<string, string>): string[] {
  return [env.OPENAI_SERVED_MODEL_NAME_OVERRIDE, env.MODEL_NAME].filter(
    (name): name is string => typeof name === "string" && name !== "",
  );
}

/** Why the worker cannot serve `model` to a coding agent; empty when it can. */
export function vllmProblems(env: Record<string, string>, model: string): string[] {
  const problems: string[] = [];
  const served = servedModels(env);
  if (!served.includes(model)) {
    problems.push(
      `it serves ${served.length > 0 ? served.map((name) => `\`${name}\``).join(" or ") : "no model"}, not \`${model}\` (MODEL_NAME or OPENAI_SERVED_MODEL_NAME_OVERRIDE)`,
    );
  }
  // The harness works through tool calls.
  if (env.ENABLE_AUTO_TOOL_CHOICE?.toLowerCase() !== "true" || !env.TOOL_CALL_PARSER) {
    problems.push(
      "it does not call tools: set ENABLE_AUTO_TOOL_CHOICE to true and TOOL_CALL_PARSER",
    );
  }
  return problems;
}

/** The context length the worker allocates for, from `MAX_MODEL_LEN`. */
export function vllmContextLength(env: Record<string, string>): number | undefined {
  const value = Number(env.MAX_MODEL_LEN);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The vLLM of the vLLM pod image (`docker/pod/Dockerfile`), whose arguments `VLLM_SETTINGS` and
 * whose parsers the lists below take (decision 1 of the plan for vLLM on pods).
 */
export const VLLM_VERSION = "0.31.0";

/**
 * The CUDA version the vLLM image is built with (`CUDA_VERSION` of its configuration,
 * docs/web/docker-hub/), which a pod's host must offer: vLLM pods are created with it as
 * `minCudaVersion` (decision 2).
 */
export const VLLM_MIN_CUDA = "13.0";

/** Where vLLM listens inside the pod: its loopback, behind the gateway. */
export const VLLM_PORT = 8000;
export const VLLM_URL = `http://127.0.0.1:${VLLM_PORT}`;

/**
 * The tool call parsers of `VLLM_VERSION`, as `--tool-call-parser` names them
 * (`_TOOL_PARSERS_TO_REGISTER` in `vllm/tool_parsers/__init__.py`, docs/web/vllm/).
 */
export const VLLM_TOOL_PARSERS: readonly string[] = [
  "dots",
  "deepseek_v3",
  "deepseek_v31",
  "deepseek_v32",
  "deepseek_v4",
  "deepseek_v41",
  "cohere_command3",
  "cohere_command4",
  "ernie45",
  "glm45",
  "glm47",
  "ling3",
  "granite-20b-fc",
  "granite",
  "granite4",
  "hermes",
  "poolside_v1",
  "hunyuan_a13b",
  "hy_v3",
  "hy_v4",
  "internlm",
  "jamba",
  "lfm2",
  "kimi_k2",
  "kimi_k3",
  "k2_horizon",
  "llama3_json",
  "llama4_json",
  "llama4_pythonic",
  "longcat",
  "mimo",
  "minimax_m2",
  "minimax_m3",
  "minicpm5",
  "mistral",
  "olmo3",
  "muse_glimmer",
  "openai",
  "phi4_mini_json",
  "pythonic",
  "qwen3_coder",
  "qwen3_xml",
  "seed_oss",
  "step3",
  "step3p5",
  "inkling",
  "xlam",
  "gigachat3",
  "functiongemma",
  "gemma4",
  "apertus",
];

/**
 * The reasoning parsers of `VLLM_VERSION`, as `--reasoning-parser` names them
 * (`_REASONING_PARSERS_TO_REGISTER` in `vllm/reasoning/__init__.py`, docs/web/vllm/).
 */
export const VLLM_REASONING_PARSERS: readonly string[] = [
  "deepseek_r1",
  "deepseek_v3",
  "deepseek_v4",
  "deepseek_v41",
  "poolside_v1",
  "cohere_command3",
  "cohere_command4",
  "ernie45",
  "gemma4",
  "glm45",
  "glm47",
  "ling3",
  "openai_gptoss",
  "granite",
  "granite_thinking_parser",
  "holo2",
  "hunyuan_a13b",
  "hy_v3",
  "hy_v4",
  "kimi_k2",
  "kimi_k3",
  "k2_horizon",
  "mimo",
  "minimax_m2",
  "minimax_m2_append_think",
  "minimax_m3",
  "mistral",
  "nemotron_v3",
  "olmo3",
  "muse_glimmer",
  "qwen3",
  "seed_oss",
  "step3",
  "step3p5",
  "inkling",
];

/**
 * The speculative decoding methods `vllm` takes, of `SpeculativeMethod` in `VLLM_VERSION`'s
 * `vllm/config/speculative.py`; not `custom_class`, which loads code. Those of
 * `DRAFT_MODEL_METHODS` need `speculative-model`, and the others refuse it.
 */
export const VLLM_SPECULATIVE_METHODS: readonly string[] = [
  "mtp",
  "ngram",
  "eagle3",
  "dflash",
  "dspark",
  "draft_model",
];
const DRAFT_MODEL_METHODS: ReadonlySet<string> = new Set([
  "eagle3",
  "dflash",
  "dspark",
  "draft_model",
]);

/** What a vLLM setting's value is. */
export type VllmValue =
  | { kind: "count"; min: number }
  | { kind: "fraction" }
  | { kind: "boolean" }
  | { kind: "choice"; values: readonly string[] }
  | { kind: "model" };

export interface VllmSetting {
  /**
   * The argument of `vllm serve` it becomes; the `speculative-*` keys together make one
   * `--speculative-config`, whose JSON field this names.
   */
  argument: string;
  value: VllmValue;
}

/**
 * The vLLM settings a pod takes, in the `vllm` block of `runpod-pod`, by their key in the
 * settings file: arguments of `VLLM_VERSION`'s `vllm serve` (`vllm/engine/arg_utils.py`,
 * `vllm/entrypoints/launchers/cli_args.py`, docs/web/vllm/). Any other key stops the run (decision 3
 * of the plan for vLLM on pods). docs/settings/vllm.md documents the same list, and a test checks
 * it.
 */
export const VLLM_SETTINGS: Readonly<Record<string, VllmSetting>> = {
  "max-model-len": { argument: "--max-model-len", value: { kind: "count", min: 1 } },
  "max-num-seqs": { argument: "--max-num-seqs", value: { kind: "count", min: 1 } },
  "gpu-memory-utilization": { argument: "--gpu-memory-utilization", value: { kind: "fraction" } },
  "kv-cache-dtype": {
    argument: "--kv-cache-dtype",
    value: {
      kind: "choice",
      values: ["auto", "bfloat16", "float16", "fp8", "fp8_e4m3", "fp8_e5m2"],
    },
  },
  "enable-prefix-caching": { argument: "--enable-prefix-caching", value: { kind: "boolean" } },
  "max-num-batched-tokens": {
    argument: "--max-num-batched-tokens",
    value: { kind: "count", min: 1 },
  },
  "tool-call-parser": {
    argument: "--tool-call-parser",
    value: { kind: "choice", values: VLLM_TOOL_PARSERS },
  },
  "reasoning-parser": {
    argument: "--reasoning-parser",
    value: { kind: "choice", values: VLLM_REASONING_PARSERS },
  },
  "speculative-method": {
    argument: "method",
    value: { kind: "choice", values: VLLM_SPECULATIVE_METHODS },
  },
  "speculative-tokens": { argument: "num_speculative_tokens", value: { kind: "count", min: 1 } },
  "speculative-model": { argument: "model", value: { kind: "model" } },
  "language-model-only": { argument: "--language-model-only", value: { kind: "boolean" } },
  "enforce-eager": { argument: "--enforce-eager", value: { kind: "boolean" } },
  "async-scheduling": { argument: "--async-scheduling", value: { kind: "boolean" } },
};

/** The keys that make `--speculative-config`. */
const SPECULATIVE_KEYS = ["speculative-method", "speculative-tokens", "speculative-model"];

/** Why Codeman serves the run's model itself. */
const SERVED = "Codeman serves the run's model on the pod's loopback, behind its gateway";
const LOOPBACK = "only Codeman's gateway calls vLLM, from the pod's loopback";
const CODE = "it loads code or files that Codeman does not ship in the pod image";
const DOWNLOADS = "Codeman has vLLM download public models from Hugging Face, onto the pod's disk";
const ONE_GPU = "a pod has one GPU";
const OFF_GPU = "it moves weights or the cache off the GPU, which runs much slower";
const SENDS = "it sends the runs' data, with the repository's code in it, off the pod";
const WRITES = "it writes the runs' requests, with the repository's code in them, to the pod's log";

/**
 * vLLM's arguments that Codeman controls, by their key, and why: setting them would break the
 * gateway's guarantees (vLLM only on the pod's loopback, behind the gateway, serving the run's
 * model wholly on the GPU) or expose the runs' requests. `ssl-*` arguments are refused like
 * `ssl-keyfile`.
 */
export const REFUSED_VLLM_SETTINGS: Readonly<Record<string, string>> = {
  host: SERVED,
  port: SERVED,
  uds: SERVED,
  "api-key": SERVED,
  "served-model-name": SERVED,
  model: SERVED,
  "enable-auto-tool-choice": "Codeman always turns it on: its agents work through tool calls",
  "allowed-origins": LOOPBACK,
  "ssl-keyfile": LOOPBACK,
  "root-path": LOOPBACK,
  middleware: CODE,
  "tool-parser-plugin": CODE,
  "reasoning-parser-plugin": CODE,
  "chat-template": CODE,
  "trust-remote-code": "it runs the model repository's code beside the runs' requests",
  "download-dir": DOWNLOADS,
  "load-format": DOWNLOADS,
  "hf-token": DOWNLOADS,
  "tensor-parallel-size": ONE_GPU,
  "pipeline-parallel-size": ONE_GPU,
  "data-parallel-size": ONE_GPU,
  "cpu-offload-gb": OFF_GPU,
  "kv-offloading-size": OFF_GPU,
  "kv-offloading-backend": OFF_GPU,
  "kv-transfer-config": SENDS,
  "kv-events-config": SENDS,
  "otlp-traces-endpoint": SENDS,
  "enable-log-requests": WRITES,
  "enable-log-outputs": WRITES,
};

/** Why a key is refused, `ssl-*` ones included; undefined when it is not. */
function refusal(key: string): string | undefined {
  return REFUSED_VLLM_SETTINGS[key.startsWith("ssl-") ? "ssl-keyfile" : key];
}

/** The key of the file for a key written as vLLM's argument, such as `--max_num_seqs`. */
function keyOf(written: string): string {
  return written.toLowerCase().replace(/^--/, "").replaceAll("_", "-");
}

/** A number above 0 and at most 1, such as `0.9`. */
const FRACTION = /^(?:0?\.[0-9]+|0|1|[01]\.[0-9]+)$/;

/**
 * Checks one key of the `vllm` block and its value, written as text; gives the value as vLLM
 * takes it, such as `4` for `04`.
 */
export function vllmSetting(
  key: string,
  text: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const setting = VLLM_SETTINGS[key];
  if (!setting) {
    const kebab = keyOf(key);
    const refused = refusal(kebab);
    if (refused) return fail(`\`vllm\` cannot set \`${kebab}\`: ${refused}.`);
    if (kebab !== key && VLLM_SETTINGS[kebab]) {
      return fail(
        `\`vllm\` takes its keys in kebab-case, without \`--\`: write \`${kebab}\`, not \`${key}\`.`,
      );
    }
    if (kebab === "speculative-config") {
      return fail(
        "`vllm` takes speculative decoding as keys of their own, since the settings file holds no JSON: `speculative-method`, `speculative-tokens` and `speculative-model`.",
      );
    }
    return fail(
      `\`vllm\` does not accept \`${key}\`; it takes ${list(Object.keys(VLLM_SETTINGS).map((name) => `\`${name}\``))} (docs/settings/vllm.md).`,
    );
  }
  const { value } = setting;
  switch (value.kind) {
    case "count": {
      const number = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
      return Number.isSafeInteger(number) && number >= value.min
        ? { ok: true, value: String(number) }
        : fail(`\`vllm\`'s \`${key}\` must be a whole number, at least ${value.min}.`);
    }
    case "fraction": {
      const number = FRACTION.test(text) ? Number(text) : Number.NaN;
      return number > 0 && number <= 1
        ? { ok: true, value: String(number) }
        : fail(`\`vllm\`'s \`${key}\` must be a number above 0 and at most 1, such as \`0.9\`.`);
    }
    case "boolean":
      return text === "true" || text === "false"
        ? { ok: true, value: text }
        : fail(`\`vllm\`'s \`${key}\` must be \`true\` or \`false\`.`);
    case "choice":
      if (value.values.includes(text)) return { ok: true, value: text };
      return fail(
        value.values.length > 10
          ? `\`vllm\`'s \`${key}\` must be one of vLLM ${VLLM_VERSION}'s, such as \`${value.values.includes("qwen3_xml") ? "qwen3_xml" : "qwen3"}\`, not \`${text}\` (docs/settings/vllm.md).`
          : `\`vllm\`'s \`${key}\` must be one of ${value.values.map((v) => `\`${v}\``).join(", ")}.`,
      );
    case "model":
      return isHuggingFaceId(text)
        ? { ok: true, value: text }
        : fail(
            `\`vllm\`'s \`${key}\` must be a Hugging Face model ID, such as \`Qwen/Qwen3-0.6B\`.`,
          );
  }
}

/** vLLM settings, by key, with their values; an empty block is none. */
export type VllmSettings = Readonly<Record<string, string>>;

/** What `tool-call-parser` is for, when a run on a pod lacks it (decision 5). */
export const TOOL_CALL_PARSER_NEEDED =
  "`vllm` needs `tool-call-parser`, the one that matches the model, such as `qwen3_xml` for Qwen3 models; see the model's card or vLLM's recipe for it (docs/settings/vllm.md).";

/**
 * Why the keys of a whole `vllm` block, inherited from every layer, do not go together; undefined
 * when they do. Speculative decoding needs a method and its tokens, and a draft model exactly
 * for the methods that use one.
 */
export function vllmBlockProblem(settings: VllmSettings | undefined): string | undefined {
  const method = settings?.["speculative-method"];
  const tokens = settings?.["speculative-tokens"];
  const model = settings?.["speculative-model"];
  if (method === undefined) {
    return tokens !== undefined || model !== undefined
      ? "`vllm`'s `speculative-tokens` and `speculative-model` go with `speculative-method`."
      : undefined;
  }
  if (tokens === undefined) {
    return `\`vllm\`'s \`speculative-method\` needs \`speculative-tokens\`, the tokens drafted per step, such as \`3\`.`;
  }
  if (DRAFT_MODEL_METHODS.has(method) && model === undefined) {
    return `\`vllm\`'s \`speculative-method: ${method}\` needs \`speculative-model\`, its draft model's Hugging Face ID.`;
  }
  if (!DRAFT_MODEL_METHODS.has(method) && model !== undefined) {
    return `\`vllm\`'s \`speculative-method: ${method}\` takes no \`speculative-model\`.`;
  }
  return undefined;
}

/**
 * The arguments of `vllm serve` for vLLM settings, by key in order, the `speculative-*` keys last
 * as one `--speculative-config`. Throws on a key, a value or a block `vllmSetting` and
 * `vllmBlockProblem` refuse.
 */
export function vllmArguments(settings: VllmSettings | undefined): string[] {
  const checked = checkedVllm(settings);
  const problem = vllmBlockProblem(checked);
  if (problem) throw new Error(problem);
  const args: string[] = [];
  const speculative: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(checked)) {
    const setting = VLLM_SETTINGS[key] as VllmSetting;
    if (SPECULATIVE_KEYS.includes(key)) {
      speculative[setting.argument] = setting.value.kind === "count" ? Number(value) : value;
    } else if (setting.value.kind === "boolean") {
      args.push(value === "true" ? setting.argument : setting.argument.replace(/^--/, "--no-"));
    } else {
      args.push(setting.argument, value);
    }
  }
  if (Object.keys(speculative).length > 0) {
    const { method, num_speculative_tokens, model } = speculative;
    args.push(
      "--speculative-config",
      JSON.stringify({ method, num_speculative_tokens, ...(model ? { model } : {}) }),
    );
  }
  return args;
}

/** Vllm settings with their values as vLLM takes them, sorted by key; throws on a refused one. */
export function checkedVllm(settings: VllmSettings | undefined): Record<string, string> {
  const entries = Object.entries(settings ?? {}).map(([key, text]) => {
    const checked = vllmSetting(key, text);
    if (!checked.ok) throw new Error(checked.error);
    return [key, checked.value] as const;
  });
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The vLLM settings a pod's `CODEMAN_VLLM` gives, as JSON, by key; none when it is unset. Only
 * the keys of `VLLM_SETTINGS`, with valid values that go together: the gateway never lets one
 * replace the arguments it sets itself.
 */
export function parseVllmSettings(
  text: string | undefined,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (text === undefined || text.trim() === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "CODEMAN_VLLM is not JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "CODEMAN_VLLM is not an object of settings." };
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!VLLM_SETTINGS[key] || typeof value !== "string") {
      return { ok: false, error: `CODEMAN_VLLM sets \`${key}\`, which Codeman does not.` };
    }
  }
  try {
    const value = checkedVllm(parsed as Record<string, string>);
    const problem = vllmBlockProblem(value);
    if (problem) return { ok: false, error: `CODEMAN_VLLM: ${problem}` };
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: `CODEMAN_VLLM: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function list(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
