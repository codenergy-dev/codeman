/**
 * Fitting the pod's model to its GPU (plan for fitting Ollama to the GPU): which contexts the
 * gateway tries, a first estimate from the model's architecture and the GPU's memory, the search
 * among them, and the check of where Ollama put the model. Ollama 0.35.1 never lowers a context it
 * is given; llama.cpp's fit puts layers on the CPU instead (docs/web/ollama/,
 * docs/web/llama-cpp/). See docs/settings/ollama.md#memory.
 */

/**
 * The least context Codeman gives an agent: Ollama recommends at least 64000 tokens for agents and
 * coding tools (docs/web/ollama/context-length.md).
 */
export const FLOOR_CONTEXT = 64_000;
/** The contexts tried between the floor and the model's own are multiples of it. */
export const CONTEXT_STEP = 4096;
/**
 * The memory llama.cpp's fit leaves free on each GPU (`LLAMA_ARG_FIT_TARGET`, 1024 MiB by
 * default), which the gateway does not change: a model wholly on the GPU leaves at least that much
 * for what grows while it runs.
 */
export const FIT_MARGIN_BYTES = 1024 * 1024 * 1024;
/** Bytes of one element of the K/V cache, by `OLLAMA_KV_CACHE_TYPE`: ggml's block sizes. */
export const KV_BYTES: Readonly<Record<string, number>> = { f16: 2, q8_0: 34 / 32, q4_0: 18 / 32 };

/** The floor for a model: 64000 tokens, or its own context when smaller. */
export function floorContext(modelContext: number | undefined): number {
  return Math.min(FLOOR_CONTEXT, modelContext ?? FLOOR_CONTEXT);
}

/**
 * The contexts the gateway may serve, smallest first: the floor, the multiples of 4096 above it,
 * and the model's own, the largest. Without the model's own, only the floor.
 */
export function contextCandidates(modelContext: number | undefined): number[] {
  const floor = floorContext(modelContext);
  const top = modelContext ?? floor;
  const contexts = [floor];
  for (let context = (Math.floor(floor / CONTEXT_STEP) + 1) * CONTEXT_STEP; context < top; ) {
    contexts.push(context);
    context += CONTEXT_STEP;
  }
  if (top > floor) contexts.push(top);
  return contexts;
}

/**
 * The K/V cache's bytes per token of one request, from `/api/show`'s `model_info`; undefined when
 * a field it needs is missing, or with a sliding window, which it cannot count. Layers with
 * attention: the per-layer `head_count_kv` summed (recurrent layers have none), or `block_count`
 * divided by `full_attention_interval` when the model has it.
 */
export function kvBytesPerToken(
  info: Readonly<Record<string, unknown>>,
  kvCacheType: string | undefined,
): number | undefined {
  const architecture = info["general.architecture"];
  if (typeof architecture !== "string") return undefined;
  const field = (name: string) => info[`${architecture}.${name}`];
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  const numbers = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "number" && item >= 0)
      ? (value as number[])
      : undefined;
  if (field("attention.sliding_window") !== undefined) return undefined;
  const headsKv = field("attention.head_count_kv");
  const headCount = field("attention.head_count");
  const heads = number(headCount) ?? Math.max(0, ...(numbers(headCount) ?? []));
  const embedding = number(field("embedding_length"));
  const keyLength =
    number(field("attention.key_length")) ??
    (embedding && heads > 0 ? embedding / heads : undefined);
  const valueLength = number(field("attention.value_length")) ?? keyLength;
  if (!keyLength || !valueLength) return undefined;
  let kvHeads: number | undefined;
  const perLayer = numbers(headsKv);
  if (perLayer) kvHeads = perLayer.reduce((sum, count) => sum + count, 0);
  else {
    const blocks = number(field("block_count"));
    const each = number(headsKv);
    const interval = number(field("full_attention_interval"));
    if (blocks && each) kvHeads = Math.floor(blocks / (interval ?? 1)) * each;
  }
  if (!kvHeads) return undefined;
  return kvHeads * (keyLength + valueLength) * (KV_BYTES[kvCacheType ?? "f16"] ?? 2);
}

/**
 * The first context to try: what the GPU's memory left by the model's weights, the fit's margin
 * and `OLLAMA_GPU_OVERHEAD` holds of the K/V cache for the parallel requests, as the largest
 * candidate within it (the floor at least). It counts no compute buffers, so it errs high, which
 * the search corrects. Undefined when it cannot tell: the search starts at the model's own.
 */
export function estimateContext(
  candidates: readonly number[],
  facts: {
    info: Readonly<Record<string, unknown>>;
    /** The model's size on disk, in bytes: its weights. */
    size: number | undefined;
    gpuMemoryGb: number | undefined;
    parallel: number;
    kvCacheType: string | undefined;
    gpuOverhead: number;
  },
): number | undefined {
  const perToken = kvBytesPerToken(facts.info, facts.kvCacheType);
  if (!perToken || !facts.size || !facts.gpuMemoryGb) return undefined;
  const free = facts.gpuMemoryGb * 2 ** 30 - facts.size - FIT_MARGIN_BYTES - facts.gpuOverhead;
  const tokens = free / (perToken * Math.max(1, facts.parallel));
  return candidates.findLast((context) => context <= tokens) ?? candidates[0];
}

/**
 * The largest context that fits: `start` when it does; otherwise the largest candidate below it
 * that does, found by halving; undefined when none does, the floor included. `fits` loads the
 * model with a context and says whether Ollama put it wholly on the GPU.
 */
export async function searchContext(
  candidates: readonly number[],
  start: number,
  fits: (context: number) => Promise<boolean>,
): Promise<number | undefined> {
  if (await fits(start)) return start;
  let low = 0;
  let high = candidates.findLastIndex((context) => context < start);
  let best: number | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const context = candidates[middle] as number;
    if (await fits(context)) {
      best = context;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

/** Where Ollama put a loaded model, from `GET /api/ps` (docs/web/ollama/list-running-models.md). */
export interface Placement {
  /** Bytes of memory it uses in all. */
  size: number;
  /** Bytes of it on the GPU. */
  sizeVram: number;
  /** One request's context, as Ollama serves it. */
  contextLength: number | undefined;
}

/**
 * The model's placement in `/api/ps`: the entry of its digest, else of its name, else the only
 * one; undefined when Ollama lists none.
 */
export function placementOf(ps: unknown, model: string, digest?: string): Placement | undefined {
  const models = (ps as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return undefined;
  type Entry = {
    name?: unknown;
    model?: unknown;
    digest?: unknown;
    size?: unknown;
    size_vram?: unknown;
    context_length?: unknown;
  };
  const entries = models as Entry[];
  const named = (entry: Entry) =>
    [model, `${model}:latest`].some((name) => entry.name === name || entry.model === name);
  const entry =
    (digest ? entries.find((one) => one.digest === digest) : undefined) ??
    entries.find(named) ??
    (entries.length === 1 ? entries[0] : undefined);
  if (!entry || typeof entry.size !== "number" || typeof entry.size_vram !== "number") {
    return undefined;
  }
  return {
    size: entry.size,
    sizeVram: entry.size_vram,
    contextLength: typeof entry.context_length === "number" ? entry.context_length : undefined,
  };
}

/**
 * Whether the model is wholly on the GPU: Ollama reports `size` equal to `size_vram` exactly when
 * every layer is (docs/web/ollama/llm-llama-server-go-at-v0-35-1.md#what-it-reports).
 */
export function onGpu(placement: Placement | undefined): placement is Placement {
  return placement !== undefined && placement.sizeVram > 0 && placement.sizeVram >= placement.size;
}

/** "4 parallel requests", "1 parallel request". */
function requests(parallel: number): string {
  return `${parallel} parallel request${parallel === 1 ? "" : "s"}`;
}

/** What Ollama did with the model, for the messages. */
function where(placement: Placement | undefined, error: string | undefined): string {
  if (!placement) return `Ollama could not load it${error ? ` (${error})` : ""}`;
  const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
  return `Ollama put ${gb(placement.size - placement.sizeVram)} of its ${gb(placement.size)} GB off the GPU, which runs much slower`;
}

/** Why the pod does not serve a context the settings give (choice 13). */
export function explicitMessage(
  model: string,
  parallel: number,
  context: number,
  placement: Placement | undefined,
  error?: string,
): string {
  return `\`${model}\` does not fit the GPU with ${requests(parallel)} and a context of ${context} tokens: ${where(placement, error)}. Lower \`context-length\` or \`num-parallel\` in the \`ollama\` settings, set \`kv-cache-type: q8_0\`, or use a GPU with more memory.`;
}

/** Why the pod does not serve even the floor (choice 13). */
export function floorMessage(
  model: string,
  parallel: number,
  context: number,
  placement: Placement | undefined,
  error?: string,
): string {
  return `\`${model}\` does not fit the GPU with ${requests(parallel)} and a context of ${context} tokens, the least Codeman gives an agent: ${where(placement, error)}. Give the profile fewer tasks (\`tasks\` or \`max-tasks\`) or set a smaller \`num-parallel\`, set \`kv-cache-type: q8_0\` in the \`ollama\` settings, or use a GPU with more memory.`;
}
