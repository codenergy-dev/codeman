import {
  OLLAMA_SERIAL_FAMILIES,
  OLLAMA_VERSION,
  ollamaContextLength,
  parseOllamaVariables,
} from "../inference/ollama.ts";
import { parseVllmSettings } from "../inference/vllm.ts";
import {
  contextCandidates,
  estimateContext,
  explicitMessage,
  floorMessage,
  onGpu,
  type Placement,
  placementOf,
  searchContext,
} from "./fit.ts";

/** The port a pod exposes, to the gateway; Ollama's own port stays on the pod's loopback. */
export const GATEWAY_PORT = 8080;

/**
 * How long a gateway whose model could not be served keeps answering, so the key jobs that wait
 * for the pod read why from its status, before it terminates the pod (choice 12 of the plan for
 * fitting Ollama to the GPU).
 */
export const FAILURE_GRACE_MS = 2 * 60_000;

/** When a pod terminates itself. See docs/inference/pods.md. */
export interface PodPolicy {
  /** The model must be served by then, in milliseconds since the epoch. */
  startBy: number;
  /**
   * A pod without a run being served waits this long: for its tasks' next runs while kept, and
   * for the key jobs that end the runs it stopped and read their usage.
   */
  keptIdleMs: number;
  /** A run without requests for this long has lost its agent. */
  runIdleMs: number;
}

/** What the gateway knows that decides whether the pod is still useful. */
export interface PodState {
  ready: boolean;
  /** Whether a run is being served. */
  serving: boolean;
  /** The last time a request arrived or a run started, stopped or ended. */
  lastActivity: number;
  /** Whether a run the gateway stopped, for its budget or its silence, waits for its close. */
  awaitingClose?: boolean | undefined;
}

/**
 * Why the pod should terminate itself now, or undefined while it is useful. The gateway stops a
 * run that spent its budget or lost its agent (`Gateway.expireRuns`), never the pod at once: a
 * pod without a run being served waits `keptIdleMs` from its last activity, for the next runs of
 * the tasks that keep it, and for the key jobs that end its stopped runs and read their usage.
 */
export function expiry(state: PodState, policy: PodPolicy, now: number): string | undefined {
  if (!state.ready) {
    return now >= policy.startBy ? "the model was not served in time" : undefined;
  }
  if (state.serving || now - state.lastActivity < policy.keptIdleMs) return undefined;
  return state.awaitingClose
    ? "it stopped its runs, and no key job ended them in time"
    : "no run came to use it";
}

/** The pod's settings, from the environment Codeman created it with. */
export interface PodSettings {
  model: string;
  /** The engine Codeman created the pod for (`CODEMAN_ENGINE`), `ollama` when unset. */
  engine: string;
  /** The engine the pod's image serves (`CODEMAN_IMAGE_ENGINE`), `ollama` when unset. */
  imageEngine: string;
  adminSha256: string;
  policy: PodPolicy;
  /**
   * The Ollama variables of `CODEMAN_OLLAMA`, from the pod's `ollama` settings, or why they
   * cannot be read: the pod then terminates rather than serve without them.
   */
  ollama: ReturnType<typeof parseOllamaVariables>;
  /**
   * The vLLM settings of `CODEMAN_VLLM`, by key, the derived `max-num-seqs` included, or why they
   * cannot be read: the pod then terminates rather than serve without them.
   */
  vllm: ReturnType<typeof parseVllmSettings>;
  /** A context that fitted the same settings before, from the cache (`CODEMAN_FIT`). */
  fitHint: FitHint | undefined;
  /** The same for vLLM, whose hint has no digest: the context alone. */
  contextHint: number | undefined;
  /** The GPU type's memory, in GB, as the provider gives it (`CODEMAN_GPU_MEMORY_GB`). */
  gpuMemoryGb: number | undefined;
}

export function podSettings(env: Record<string, string | undefined>): PodSettings {
  const model = env.CODEMAN_MODEL;
  const adminSha256 = env.CODEMAN_ADMIN_SHA256;
  const startBy = Date.parse(env.CODEMAN_START_BY ?? "");
  const keptIdle = Number(env.CODEMAN_KEPT_IDLE_MINUTES ?? "15");
  const runIdle = Number(env.CODEMAN_RUN_IDLE_MINUTES ?? "30");
  if (!model || !adminSha256 || !/^[0-9a-f]{64}$/.test(adminSha256) || Number.isNaN(startBy)) {
    throw new Error("CODEMAN_MODEL, CODEMAN_ADMIN_SHA256 and CODEMAN_START_BY are required.");
  }
  if (!(keptIdle > 0) || !(runIdle > 0)) throw new Error("Idle limits must be positive.");
  return {
    model,
    engine: env.CODEMAN_ENGINE || "ollama",
    imageEngine: env.CODEMAN_IMAGE_ENGINE || "ollama",
    adminSha256,
    policy: { startBy, keptIdleMs: keptIdle * 60_000, runIdleMs: runIdle * 60_000 },
    ollama: parseOllamaVariables(env.CODEMAN_OLLAMA),
    vllm: parseVllmSettings(env.CODEMAN_VLLM),
    fitHint: parseFitHint(env.CODEMAN_FIT),
    contextHint: parseContextHint(env.CODEMAN_FIT),
    gpuMemoryGb: positive(Number(env.CODEMAN_GPU_MEMORY_GB ?? "")),
  };
}

/** A positive, finite number, or undefined. */
function positive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The cached fit a pod's `CODEMAN_FIT` gives, as JSON: `{"contextLength":131072,"digest":"…"}`.
 * Undefined when unset or unreadable: the gateway then searches, so a broken hint costs time only.
 */
export function parseFitHint(text: string | undefined): FitHint | undefined {
  if (!text) return undefined;
  try {
    const { contextLength, digest } = JSON.parse(text) as Partial<FitHint>;
    return Number.isSafeInteger(contextLength) &&
      (contextLength ?? 0) > 0 &&
      typeof digest === "string" &&
      digest !== ""
      ? { contextLength: contextLength as number, digest }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The context a vLLM pod's `CODEMAN_FIT` gives, as JSON: `{"contextLength":131072}`. Undefined
 * when unset or unreadable: vLLM then fits it, so a broken hint costs time only.
 */
export function parseContextHint(text: string | undefined): number | undefined {
  if (!text) return undefined;
  try {
    const { contextLength } = JSON.parse(text) as { contextLength?: unknown };
    return Number.isSafeInteger(contextLength) && (contextLength as number) > 0
      ? (contextLength as number)
      : undefined;
  } catch {
    return undefined;
  }
}

/** What the gateway fits the model with, from the pod's Ollama variables and environment. */
export function fitOptions(
  variables: Readonly<Record<string, string>>,
  settings: Pick<PodSettings, "fitHint" | "gpuMemoryGb">,
): FitOptions {
  return {
    configured: positive(Number(variables.OLLAMA_CONTEXT_LENGTH ?? "")),
    parallel: positive(Number(variables.OLLAMA_NUM_PARALLEL ?? "")) ?? 1,
    kvCacheType: variables.OLLAMA_KV_CACHE_TYPE,
    gpuOverhead: Number(variables.OLLAMA_GPU_OVERHEAD ?? "") || 0,
    gpuMemoryGb: settings.gpuMemoryGb,
    hint: settings.fitHint,
  };
}

/**
 * The environment of `ollama serve`: the gateway's, then the variables of the pod's Ollama
 * settings, then those the gateway sets itself, which always win: Ollama on the pod's loopback,
 * the model kept loaded, and the context length it was restarted with.
 */
export function ollamaServeEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  variables: Readonly<Record<string, string>>,
  contextLength: number | undefined,
): Record<string, string | undefined> {
  return {
    ...base,
    ...variables,
    OLLAMA_HOST: "127.0.0.1:11434",
    OLLAMA_KEEP_ALIVE: "-1",
    ...(contextLength ? { OLLAMA_CONTEXT_LENGTH: String(contextLength) } : {}),
  };
}

/** Ollama's server as the pod runs it: started, or restarted with a context length. */
export interface OllamaServer {
  url: string;
  restart(contextLength: number | undefined): Promise<void>;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

/** What the gateway fits the model with, from the pod's settings and environment. */
export interface FitOptions {
  /** The `context-length` of the pod's Ollama settings, which Ollama started with. */
  configured?: number | undefined;
  /** `OLLAMA_NUM_PARALLEL`, 1 when unset. */
  parallel: number;
  kvCacheType?: string | undefined;
  /** `OLLAMA_GPU_OVERHEAD`, in bytes. */
  gpuOverhead?: number | undefined;
  /** The GPU type's memory, as the provider gives it (`CODEMAN_GPU_MEMORY_GB`). */
  gpuMemoryGb?: number | undefined;
  /** A context that fitted the same settings before (`CODEMAN_FIT`), for the model's digest. */
  hint?: FitHint | undefined;
}

/** A context from the cache of fits, and the digest of the model it was found for. */
export interface FitHint {
  contextLength: number;
  digest: string;
}

/**
 * How the gateway fitted the model to the GPU, which `/admin/status` reports as `fit` (choice 14
 * of the plan for fitting Ollama to the GPU).
 */
export interface FitReport {
  /** None: vLLM's reports say `vllm` (`VllmFitReport`). */
  engine?: undefined;
  /** One request's context, as Ollama serves it. */
  contextLength: number;
  /** The model's own context length; undefined when it does not say. */
  modelContextLength: number | undefined;
  /** The parallel requests asked, and those Ollama serves. */
  requestedParallel: number;
  parallel: number;
  /** Where the context came from: the pod's settings, the cache of fits, or a search. */
  source: "settings" | "cache" | "search";
  /** How many times the gateway loaded the model. */
  loads: number;
  digest: string | undefined;
  /** Bytes of memory the model uses, all of them on the GPU. */
  size: number;
  sizeVram: number;
  family: string | undefined;
  /**
   * Whether the model reads images: `/api/show` lists its `vision` capability. None from gateways
   * before it.
   */
  vision?: boolean | undefined;
}

/** The model's start failed for a reason its settings can fix; `message` says how. */
export class FitFailure extends Error {}

/**
 * Pulls the model, then loads it with the context the pod serves, checking with `/api/ps` that
 * Ollama put it wholly on the GPU (decision 1 of the plan for fitting Ollama to the GPU). With
 * `configured`, the `context-length` of the pod's settings, Ollama already started with it. Without
 * it, the gateway restarts Ollama with each context it tries: the cached one when its digest
 * matches, else the estimate, else the model's own; then, when that does not fit, smaller ones,
 * down to the floor (decision 3). Throws `FitFailure` when nothing fits. See docs/web/ollama/.
 */
export async function prepareOllama(
  server: OllamaServer,
  model: string,
  log: (message: string) => void,
  options: FitOptions = { parallel: 1 },
): Promise<FitReport> {
  const fetchFn = server.fetch ?? fetch;
  const call = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetchFn(`${server.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = /"error"\s*:\s*"([^"]*)"/.exec(text)?.[1];
      throw new Error(`Ollama ${path} failed with ${response.status}${error ? `: ${error}` : ""}.`);
    }
    return response.json();
  };
  await untilUp(server);
  log(`Pulling ${model}.`);
  await pull(server, model);
  const show = (await call("/api/show", { model })) as {
    model_info?: Record<string, unknown>;
    details?: { family?: unknown };
    capabilities?: unknown;
  } | null;
  const modelContext = ollamaContextLength(show);
  const family = typeof show?.details?.family === "string" ? show.details.family : undefined;
  const vision = Array.isArray(show?.capabilities) && show.capabilities.includes("vision");
  const listed = modelEntry(await call("/api/tags"), model);
  const parallel = family && OLLAMA_SERIAL_FAMILIES.has(family) ? 1 : options.parallel;
  if (parallel < options.parallel) {
    log(
      `Warning: Ollama ${OLLAMA_VERSION} serves the ${family} family one request at a time, whatever num-parallel says: the requests of the runs on this pod wait for each other.`,
    );
  }

  let current = options.configured;
  let loads = 0;
  const placements = new Map<number, { placement: Placement | undefined; error?: string }>();
  /** Loads the model with a context, restarting Ollama when it runs with another. */
  const load = async (context: number): Promise<Placement | undefined> => {
    if (current !== context) {
      await server.restart(context);
      current = context;
      await untilUp(server);
    }
    loads++;
    let error: string | undefined;
    try {
      await call("/api/generate", { model, keep_alive: -1 });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    const placement =
      error === undefined ? placementOf(await call("/api/ps"), model, listed.digest) : undefined;
    placements.set(context, { placement, ...(error ? { error } : {}) });
    const off = placement ? placement.size - placement.sizeVram : 0;
    const outcome = !placement
      ? `not loaded${error ? ` (${error})` : ""}`
      : onGpu(placement)
        ? "wholly on the GPU"
        : `${(off / 1e9).toFixed(1)} GB off the GPU`;
    log(
      `Loaded ${model} with ${parallel} parallel request(s) and a context of ${context} tokens: ${outcome}.`,
    );
    return placement;
  };
  const report = (
    context: number,
    placement: Placement,
    source: FitReport["source"],
  ): FitReport => ({
    contextLength: placement.contextLength ?? context,
    modelContextLength: modelContext,
    requestedParallel: options.parallel,
    parallel,
    source,
    loads,
    digest: listed.digest,
    size: placement.size,
    sizeVram: placement.sizeVram,
    family,
    vision,
  });

  if (options.configured) {
    const context = options.configured;
    const placement = await load(context);
    if (!onGpu(placement)) {
      const { error } = placements.get(context) ?? {};
      throw new FitFailure(explicitMessage(model, parallel, context, placement, error));
    }
    log(`Serving ${model} with a context length of ${context}, from the pod's settings.`);
    return report(context, placement, "settings");
  }

  const candidates = contextCandidates(modelContext);
  const top = candidates.at(-1) as number;
  const { hint } = options;
  const cached =
    hint && hint.digest === listed.digest && hint.contextLength <= top
      ? Math.max(hint.contextLength, candidates[0] as number)
      : undefined;
  const estimate = estimateContext(candidates, {
    info: show?.model_info ?? {},
    size: listed.size,
    gpuMemoryGb: options.gpuMemoryGb,
    parallel,
    kvCacheType: options.kvCacheType,
    gpuOverhead: options.gpuOverhead ?? 0,
  });
  const start = cached ?? estimate ?? top;
  log(
    cached
      ? `Trying the context that fitted these settings before: ${cached} tokens.`
      : `Fitting ${model} to the GPU, from ${start} tokens (the model's own is ${modelContext ?? "unknown"}).`,
  );
  const best = await searchContext(candidates, start, async (context) =>
    onGpu(await load(context)),
  );
  if (best === undefined) {
    const floor = candidates[0] as number;
    const { placement, error } = placements.get(floor) ?? { placement: undefined };
    throw new FitFailure(floorMessage(model, parallel, floor, placement, error));
  }
  // The last load may have tried a larger context: serve the best one, and check it again.
  const placement = current === best ? placements.get(best)?.placement : await load(best);
  if (!onGpu(placement)) {
    const { error } = placements.get(best) ?? {};
    throw new FitFailure(explicitMessage(model, parallel, best, placement, error));
  }
  log(`Serving ${model} with a context length of ${best}.`);
  return report(best, placement, cached === best && loads === 1 ? "cache" : "search");
}

/** The model's digest and size on disk, from `GET /api/tags` (docs/web/ollama/list-models.md). */
function modelEntry(tags: unknown, model: string): { digest?: string; size?: number } {
  const models = (tags as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return {};
  const names = [model, `${model}:latest`];
  const entry = (
    models as { name?: unknown; model?: unknown; digest?: unknown; size?: unknown }[]
  ).find((one) => names.some((name) => one.name === name || one.model === name));
  return {
    ...(typeof entry?.digest === "string" ? { digest: entry.digest } : {}),
    ...(typeof entry?.size === "number" ? { size: entry.size } : {}),
  };
}

/**
 * Pulls the model, streaming Ollama's progress: a large model takes longer to pull than `fetch`
 * waits for a response to start. Throws when a line reports an error.
 */
async function pull(server: OllamaServer, model: string): Promise<void> {
  const response = await (server.fetch ?? fetch)(`${server.url}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!response.ok || !response.body)
    throw new Error(`Ollama /api/pull failed with ${response.status}.`);
  const decoder = new TextDecoder();
  let rest = "";
  let last: { status?: string; error?: string } = {};
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      last = JSON.parse(line) as typeof last;
      if (last.error) throw new Error(`Ollama could not pull ${model}: ${last.error}`);
    }
  }
  if (rest.trim() !== "") last = JSON.parse(rest) as typeof last;
  if (last.error || last.status !== "success") {
    throw new Error(`Ollama could not pull ${model}: ${last.error ?? last.status ?? "no status"}`);
  }
}

async function untilUp(server: OllamaServer): Promise<void> {
  const wait = server.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await (server.fetch ?? fetch)(`${server.url}/api/version`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await wait(1_000);
  }
  throw new Error("Ollama did not start.");
}
