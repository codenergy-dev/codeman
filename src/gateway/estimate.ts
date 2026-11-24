import { OLLAMA_SERIAL_FAMILIES } from "../inference/ollama.ts";
import { FIT_MARGIN_BYTES, floorContext, kvBytesPerToken } from "./fit.ts";

/**
 * An estimate of the fit before a pod is created (plan of 2026-11-23): whether the engine's K/V
 * cache can hold the pod's parallel requests at its context, counting the weights and the engine's
 * fixed budget, and no other overhead. It is optimistic on purpose (decision 2): it refuses only a
 * pod that even this bound shows short of memory, and leaves what is near the edge to the
 * gateway's fit, which measures. Shared by `open-key`, before it creates a pod.
 */

const GIB = 2 ** 30;

/**
 * vLLM 0.32.0's default `gpu_memory_utilization` (`CacheConfig`,
 * docs/web/vllm/vllm-config-cache-py-at-v0-32-0.md): the share of the GPU's total memory the
 * engine may use, weights included (`request_memory`, docs/web/vllm/).
 */
export const VLLM_GPU_MEMORY_UTILIZATION = 0.92;

/**
 * Keys of a `config.json` whose attention the estimate cannot count as one cache per layer:
 * multi-head latent attention, hybrid and linear attention, state-space layers, chunked
 * attention. A model with one of them gets no estimate.
 */
const UNCOUNTED_KEYS = [
  "kv_lora_rank",
  "layers_block_type",
  "hybrid_override_pattern",
  "attn_type_list",
  "attention_chunk_size",
  "full_attention_interval",
  "linear_attn_config",
  "ssm_cfg",
  "mamba_expand",
];

export interface FitEstimate {
  engine: "vllm" | "ollama";
  /** Requests the pod serves at once. */
  parallel: number;
  /** Tokens of each request's context: the settings', or the floor. */
  context: number;
  /** Whether the context is the floor, the least Codeman gives an agent, rather than the settings'. */
  floor: boolean;
  /** Bytes of the K/V cache for one token of one request. */
  perToken: number;
  /** Bytes the K/V cache needs: `parallel` requests of `context` tokens. */
  needed: number;
  /** The most the K/V cache can have: the engine's budget less the weights, and nothing else. */
  room: number;
  /** The engine's budget, in bytes, before the weights. */
  budget: number;
  weightsBytes: number;
  fits: boolean;
}

type Config = Readonly<Record<string, unknown>>;

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The part of a `config.json` that describes the language model: the configuration itself, or
 * its `text_config` when only that has the layers, as a multimodal model's has.
 */
function textConfig(config: Config): Config {
  const nested = config.text_config;
  return positive(config.num_hidden_layers) === undefined &&
    typeof nested === "object" &&
    nested !== null
    ? (nested as Config)
    : config;
}

/**
 * vLLM's K/V cache's bytes per token of one request, from the model's `config.json`, as vLLM
 * 0.32.0 counts a full-attention layer (`get_num_kv_heads`, `get_head_size` in `config/model.py`,
 * docs/web/vllm/): 2 × layers × K/V heads × head size × the cache's bytes, 1 with an `fp8`
 * cache, else 2 (vLLM serves `float32` weights in 16 bits). Undefined when it cannot count: a
 * missing field, a sliding window, or an attention of `UNCOUNTED_KEYS`.
 */
export function vllmKvBytesPerToken(
  config: Config,
  kvCacheDtype: string | undefined,
): number | undefined {
  const text = textConfig(config);
  if (UNCOUNTED_KEYS.some((key) => text[key] !== undefined && text[key] !== null)) return undefined;
  const layerTypes = text.layer_types;
  if (Array.isArray(layerTypes) && layerTypes.some((type) => type !== "full_attention")) {
    return undefined;
  }
  if (positive(text.sliding_window) !== undefined && text.use_sliding_window !== false) {
    return undefined;
  }
  const layers = positive(text.num_hidden_layers);
  const heads = positive(text.num_attention_heads);
  const kvHeads = positive(text.num_key_value_heads) ?? heads;
  const headSize =
    positive(text.head_dim) ??
    (heads && positive(text.hidden_size) ? (text.hidden_size as number) / heads : undefined);
  if (!layers || !kvHeads || !headSize) return undefined;
  const bytes = kvCacheDtype?.startsWith("fp8") ? 1 : 2;
  return 2 * layers * kvHeads * headSize * bytes;
}

/** The model's own context, from its `config.json`: `max_position_embeddings`. */
export function vllmModelContext(config: Config): number | undefined {
  return positive(textConfig(config).max_position_embeddings);
}

/**
 * A vLLM pod's estimate: its budget, the GPU's memory × `gpu-memory-utilization`, less the
 * weights, against `max-num-seqs` requests of `max-model-len`, or of the floor without it.
 * Undefined when it cannot count, or without the GPU's memory.
 */
export function estimateVllm(facts: {
  config: Config;
  weightsBytes: number;
  gpuMemoryGb: number | undefined;
  /** The pod's vLLM settings, `max-num-seqs` included. */
  settings: Readonly<Record<string, string>>;
}): FitEstimate | undefined {
  const { config, weightsBytes, gpuMemoryGb, settings } = facts;
  const perToken = vllmKvBytesPerToken(config, settings["kv-cache-dtype"]);
  const explicit = positive(Number(settings["max-model-len"]));
  const own = vllmModelContext(config);
  const context = explicit ?? (own === undefined ? undefined : floorContext(own));
  if (!perToken || !context || !positive(gpuMemoryGb)) return undefined;
  const utilization =
    positive(Number(settings["gpu-memory-utilization"])) ?? VLLM_GPU_MEMORY_UTILIZATION;
  const budget = (gpuMemoryGb as number) * GIB * utilization;
  return result("vllm", {
    parallel: positive(Number(settings["max-num-seqs"])) ?? 1,
    context,
    floor: explicit === undefined,
    perToken,
    budget,
    weightsBytes,
  });
}

/**
 * An Ollama pod's estimate: the GPU's memory less llama.cpp's fit margin, `gpu-overhead` and the
 * weights, against `num-parallel` requests (one for the families Ollama serves serially) of
 * `context-length`, or of the floor without it, at `kv-cache-type`. The bytes per token are the
 * gateway's own (`kvBytesPerToken`). Undefined when it cannot count, or without the GPU's memory.
 */
export function estimateOllama(facts: {
  /** The model's GGUF metadata, as `/api/show`'s `model_info` gives it. */
  info: Readonly<Record<string, unknown>>;
  weightsBytes: number;
  gpuMemoryGb: number | undefined;
  /** The pod's Ollama variables, such as `OLLAMA_NUM_PARALLEL`. */
  variables: Readonly<Record<string, string>>;
}): FitEstimate | undefined {
  const { info, weightsBytes, gpuMemoryGb, variables } = facts;
  const architecture = info["general.architecture"];
  if (typeof architecture !== "string") return undefined;
  const perToken = kvBytesPerToken(info, variables.OLLAMA_KV_CACHE_TYPE);
  const explicit = positive(Number(variables.OLLAMA_CONTEXT_LENGTH));
  const own = positive(info[`${architecture}.context_length`]);
  const context = explicit ?? (own === undefined ? undefined : floorContext(own));
  if (!perToken || !context || !positive(gpuMemoryGb)) return undefined;
  const overhead = Number(variables.OLLAMA_GPU_OVERHEAD) || 0;
  const budget = (gpuMemoryGb as number) * GIB - FIT_MARGIN_BYTES - overhead;
  return result("ollama", {
    parallel: OLLAMA_SERIAL_FAMILIES.has(architecture)
      ? 1
      : (positive(Number(variables.OLLAMA_NUM_PARALLEL)) ?? 1),
    context,
    floor: explicit === undefined,
    perToken,
    budget,
    weightsBytes,
  });
}

function result(
  engine: FitEstimate["engine"],
  facts: Omit<FitEstimate, "engine" | "needed" | "room" | "fits">,
): FitEstimate {
  const needed = facts.parallel * facts.context * facts.perToken;
  const room = facts.budget - facts.weightsBytes;
  return { engine, ...facts, needed, room, fits: needed <= room };
}

function gib(bytes: number): string {
  return (bytes / GIB).toFixed(2);
}

/** "4 parallel requests", "1 parallel request". */
function requests(parallel: number): string {
  return `${parallel} parallel request${parallel === 1 ? "" : "s"}`;
}

/**
 * Why `open-key` created no pod: the estimate's numbers, then the gateway's levers for the same
 * case, an explicit context or the floor.
 */
export function estimateMessage(model: string, gpuMemoryGb: number, estimate: FitEstimate): string {
  const { engine, parallel, context, floor, needed, room, weightsBytes } = estimate;
  const least = floor ? ", the least Codeman gives an agent" : "";
  const budget =
    engine === "vllm"
      ? `the GPU's ${gpuMemoryGb} GB at vLLM's memory utilization, less ${gib(weightsBytes)} GiB of weights`
      : `the GPU's ${gpuMemoryGb} GB, less llama.cpp's margin of 1 GiB, the settings' overhead and ${gib(weightsBytes)} GiB of weights`;
  const leaves = room > 0 ? `leave at most ${gib(room)} GiB` : "leave nothing";
  const why = `\`${model}\` does not fit the GPU with ${requests(parallel)} and a context of ${context} tokens${least}, by Codeman's estimate, so no pod was created: its K/V cache needs ${gib(needed)} GiB, and ${budget}, ${leaves}.`;
  const levers =
    engine === "vllm"
      ? floor
        ? "Give the profile fewer tasks (`tasks` or `max-tasks`) or set a smaller `max-num-seqs`, set `kv-cache-dtype: fp8` or `language-model-only: true` in the `vllm` settings, or use a GPU with more memory."
        : "Lower `max-model-len` or `max-num-seqs` in the `vllm` settings, set `kv-cache-dtype: fp8` or `language-model-only: true`, or use a GPU with more memory."
      : floor
        ? "Give the profile fewer tasks (`tasks` or `max-tasks`) or set a smaller `num-parallel`, set `kv-cache-type: q8_0` in the `ollama` settings, use a smaller quantization of the model, or use a GPU with more memory."
        : "Lower `context-length` or `num-parallel` in the `ollama` settings, set `kv-cache-type: q8_0`, use a smaller quantization of the model, or use a GPU with more memory.";
  return `${why} ${levers}`;
}
