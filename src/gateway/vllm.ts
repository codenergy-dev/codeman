/**
 * Serving the pod's model with vLLM (plan for vLLM on pods): its arguments, its start, the context
 * it serves for the requests the pod takes at once, and a probe of its tool calls. vLLM refuses to
 * start rather than put the model or its cache off the GPU, and reports how many requests of its
 * context its cache holds (docs/web/vllm/). See docs/settings/vllm.md#memory.
 */
import { vllmArguments } from "../inference/vllm.ts";
import { CONTEXT_STEP, floorContext } from "./fit.ts";

/** The model's start failed for a reason its settings can fix; `message` says how. */
export class VllmFitFailure extends Error {}

/** vLLM stopped before it served, with the reason its output gives. */
export class VllmStopped extends Error {}

/** How the gateway served the model with vLLM, which `/admin/status` reports as `fit`. */
export interface VllmFitReport {
  engine: "vllm";
  /** One request's context, as vLLM serves it (`max_model_len`). */
  contextLength: number;
  /** The model's own context length, when vLLM's auto-fit said it; undefined otherwise. */
  modelContextLength: number | undefined;
  /** The requests at once asked (`max-num-seqs`), and those served, the same. */
  requestedParallel: number;
  parallel: number;
  /** How many requests of `contextLength` vLLM's K/V cache holds at once, and its tokens. */
  concurrency: number;
  cacheTokens: number;
  /** Where the context came from: the pod's settings, the cache of fits, or vLLM's measures. */
  source: "settings" | "cache" | "search";
  /** How many times the gateway started vLLM. */
  loads: number;
  /** The tool call parser the probe passed with. */
  toolCallParser: string;
}

/** vLLM's server as the pod runs it. */
export interface VllmServer {
  /** Its loopback URL, such as `http://127.0.0.1:8000`. */
  url: string;
  /** Starts it with a context, or `auto` for the largest that fits one request; stops it first. */
  start(maxModelLen: number | "auto"): Promise<void>;
  /** Why it stopped since its last start, from its output; undefined while it runs. */
  stopped(): string | undefined;
  /** What it wrote since its last start, its last lines at least. */
  output(): readonly string[];
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** What the gateway serves the model with, from the pod's settings and environment. */
export interface VllmFitOptions {
  /** The `max-model-len` of the pod's settings. */
  configured?: number | undefined;
  /** `max-num-seqs`: how many requests the pod serves at once. */
  maxNumSeqs: number;
  /** A context that fitted the same settings before (`CODEMAN_FIT`). */
  hint?: number | undefined;
  toolCallParser: string;
}

/**
 * The arguments of `vllm serve` for the pod's model and settings: on the loopback, under the
 * run's model's name, with tool calls, and the context given, which replaces the settings' own.
 */
export function vllmServeArguments(
  model: string,
  settings: Readonly<Record<string, string>>,
  maxModelLen: number | "auto",
): string[] {
  const { "max-model-len": _, ...rest } = settings;
  return [
    "serve",
    model,
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    "--served-model-name",
    model,
    "--enable-auto-tool-choice",
    ...vllmArguments(rest),
    "--max-model-len",
    String(maxModelLen),
  ];
}

/** A MIG partition's UUID, as `CUDA_VISIBLE_DEVICES` may hold it. */
const MIG_UUID = /^MIG-/;

/**
 * The environment of `vllm serve`: the gateway's, without the pod's Runpod key, never reporting
 * usage, and with the GPU by index when it is a MIG partition's UUID, on which vLLM 0.31.0 fails
 * to start (docs/plans/2026-10-13-vllm-on-pods.md, MIG).
 */
export function vllmServeEnvironment(
  base: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const { RUNPOD_API_KEY: _, ...rest } = base;
  return {
    ...rest,
    VLLM_NO_USAGE_STATS: "1",
    DO_NOT_TRACK: "1",
    ...(MIG_UUID.test(base.CUDA_VISIBLE_DEVICES ?? "") ? { CUDA_VISIBLE_DEVICES: "0" } : {}),
  };
}

/** What vLLM's cache holds, from the labels of `vllm:cache_config_info` on `/metrics`. */
export function cacheCapacity(
  metrics: string,
): { cacheTokens: number; concurrency: number } | undefined {
  const line = metrics.split("\n").find((one) => one.startsWith("vllm:cache_config_info{"));
  if (!line) return undefined;
  const labels = new Map(
    [...line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const cacheTokens = Number(labels.get("kv_cache_size_tokens"));
  const concurrency = Number(labels.get("kv_cache_max_concurrency"));
  return Number.isFinite(cacheTokens) && cacheTokens > 0 && Number.isFinite(concurrency)
    ? { cacheTokens, concurrency }
    : undefined;
}

/** The context vLLM serves the model with, from `GET /v1/models`'s `max_model_len`. */
export function servedContext(models: unknown, model: string): number | undefined {
  const data = (models as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return undefined;
  const entries = data as { id?: unknown; max_model_len?: unknown }[];
  const entry = entries.find((one) => one.id === model) ?? entries[0];
  const length = entry?.max_model_len;
  return typeof length === "number" && Number.isSafeInteger(length) && length > 0
    ? length
    : undefined;
}

/**
 * The model's own context, from vLLM's auto-fit lines: "full model context length N fits", or
 * "reduced from N to M" (docs/web/vllm/vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md).
 */
export function autoFitModelContext(lines: readonly string[]): number | undefined {
  for (const line of [...lines].reverse()) {
    const match =
      /Auto-fit max_model_len: full model context length (\d+) fits/.exec(line) ??
      /Auto-fit max_model_len: reduced from (\d+) to \d+/.exec(line);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/**
 * Why vLLM stopped, from its last lines: its last error, else its exit. The engine's process
 * reports the cause, and the server's then a generic failure that points to it, which is skipped.
 */
export function vllmError(lines: readonly string[], exit: string): string {
  const errors = lines
    .filter((line) => /\b[A-Za-z]*(Error|Exception):/.test(line))
    .map((line) => line.replace(/^.*?\b([A-Za-z]*(Error|Exception):)/, "$1").trim());
  const text =
    errors.findLast((error) => !/root cause above|initialization failed/i.test(error)) ??
    errors.at(-1);
  return text ? (text.length > 600 ? `${text.slice(0, 599)}…` : text) : exit;
}

/**
 * Restarts after vLLM's first measure, each with a smaller context: the first from the cache's
 * tokens, the second from the two measures.
 */
const MAX_RESTARTS = 2;

/** What one start of vLLM served. */
interface Measure {
  contextLength: number;
  cacheTokens: number;
  concurrency: number;
}

/**
 * The next context to try, a multiple of 4096 below the last one, whose cache should hold `n`
 * requests. From one measure, the cache's tokens divided among them; from two, the line through
 * the two measures of the cache's share per request, which a hybrid model's fixed state per
 * request bends.
 */
export function nextContext(measures: readonly Measure[], n: number): number {
  const last = measures.at(-1) as Measure;
  const step = (tokens: number) => Math.floor(tokens / CONTEXT_STEP) * CONTEXT_STEP;
  let target = step(last.cacheTokens / n);
  const before = measures.at(-2);
  if (before && before.contextLength !== last.contextLength) {
    // The share of the cache one request takes, 1 / concurrency, grows linearly with its length.
    const slope =
      (1 / last.concurrency - 1 / before.concurrency) / (last.contextLength - before.contextLength);
    const base = 1 / last.concurrency - slope * last.contextLength;
    if (slope > 0) target = step((1 / n - base) / slope);
  }
  return Math.min(target, last.contextLength - CONTEXT_STEP);
}

/** "4 parallel requests", "1 parallel request". */
function requests(n: number): string {
  return `${n} parallel request${n === 1 ? "" : "s"}`;
}

/** What vLLM's cache holds, for the messages. */
function holds(measure: Measure): string {
  return `vLLM's K/V cache holds ${measure.concurrency.toFixed(2)} of them (${Math.round(measure.cacheTokens)} tokens)`;
}

/** Why the pod does not serve an explicit `max-model-len` for its requests. */
export function vllmExplicitMessage(model: string, n: number, measure: Measure): string {
  return `\`${model}\` does not fit the GPU with ${requests(n)} and a context of ${measure.contextLength} tokens: ${holds(measure)}. Lower \`max-model-len\` or \`max-num-seqs\` in the \`vllm\` settings, set \`kv-cache-dtype: fp8\` or \`language-model-only: true\`, or use a GPU with more memory.`;
}

/** Why the pod does not serve even the floor. */
export function vllmFloorMessage(
  model: string,
  n: number,
  floor: number,
  measure: Measure,
): string {
  return `\`${model}\` does not fit the GPU with ${requests(n)} and a context of ${floor} tokens, the least Codeman gives an agent: with a context of ${measure.contextLength} tokens, ${holds(measure)}. Give the profile fewer tasks (\`tasks\` or \`max-tasks\`) or set a smaller \`max-num-seqs\`, set \`kv-cache-dtype: fp8\` or \`language-model-only: true\` in the \`vllm\` settings, or use a GPU with more memory.`;
}

/** Why the pod found no context for its requests in the starts it allows itself. */
export function vllmUnfitMessage(
  model: string,
  n: number,
  loads: number,
  measure: Measure,
): string {
  return `vLLM found no context of \`${model}\` for ${requests(n)} in ${loads} starts: with a context of ${measure.contextLength} tokens, ${holds(measure)}. Set \`max-model-len\` in the \`vllm\` settings, give the profile fewer tasks, or use a GPU with more memory.`;
}

/** Why vLLM did not start with a context. */
export function vllmStartMessage(
  model: string,
  context: number | "auto",
  reason: string,
  explicit: boolean,
): string {
  const with_ = context === "auto" ? "" : ` with a context of ${context} tokens`;
  const fix = explicit
    ? " Lower `max-model-len` in the `vllm` settings, set `kv-cache-dtype: fp8` or `language-model-only: true`, or use a GPU with more memory."
    : "";
  return `vLLM did not start \`${model}\`${with_}: ${reason}${fix}`;
}

/** Why the probe failed: the parser does not match the model's tool calls. */
export function vllmProbeMessage(model: string, parser: string, detail: string): string {
  return `vLLM did not return a tool call with the parser \`${parser}\`: it may not match \`${model}\` (${detail}). Set the \`tool-call-parser\` that the model's card or vLLM's recipe gives in the \`vllm\` settings.`;
}

/**
 * Starts vLLM and serves the model with a context whose cache holds `maxNumSeqs` requests at once
 * (decision 4 of the plan for vLLM on pods): the configured one, which must; else the cached one
 * when it does; else vLLM's auto-fit, then, when its cache holds fewer, at most two restarts with
 * smaller contexts, down to the floor. Then probes a tool call (decision 5). Throws
 * `VllmFitFailure` when the settings must change.
 */
export async function prepareVllm(
  server: VllmServer,
  model: string,
  log: (message: string) => void,
  options: VllmFitOptions,
): Promise<VllmFitReport> {
  const fetchFn = server.fetch ?? fetch;
  const now = server.now ?? Date.now;
  const wait = server.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const n = options.maxNumSeqs;
  let loads = 0;

  const get = async (path: string): Promise<Response> => {
    const response = await fetchFn(`${server.url}${path}`);
    if (!response.ok) throw new Error(`vLLM ${path} answered ${response.status}.`);
    return response;
  };
  /** Starts vLLM with a context and waits until it serves; throws `VllmStopped` if it stops. */
  const launch = async (context: number | "auto"): Promise<Measure> => {
    loads++;
    const started = now();
    log(
      context === "auto"
        ? `Starting vLLM for ${model}, with the largest context that fits the GPU for one request.`
        : `Starting vLLM for ${model}, with a context of ${context} tokens.`,
    );
    await server.start(context);
    for (;;) {
      const reason = server.stopped();
      if (reason !== undefined) throw new VllmStopped(reason);
      const healthy = await fetchFn(`${server.url}/health`)
        .then((response) => response.ok)
        .catch(() => false);
      if (healthy) break;
      await wait(2_000);
    }
    const contextLength = servedContext(await (await get("/v1/models")).json(), model);
    const capacity = cacheCapacity(await (await get("/metrics")).text());
    if (contextLength === undefined || capacity === undefined) {
      throw new Error("vLLM did not report its context and its cache's capacity.");
    }
    const measure = { contextLength, ...capacity };
    log(
      `vLLM serves ${model} after ${((now() - started) / 1000).toFixed(0)} s, with a context of ${contextLength} tokens: its K/V cache holds ${capacity.concurrency.toFixed(2)} requests of it (${Math.round(capacity.cacheTokens)} tokens).`,
    );
    return measure;
  };
  const failed = (error: unknown, context: number | "auto", explicit: boolean): never => {
    if (error instanceof VllmStopped) {
      throw new VllmFitFailure(vllmStartMessage(model, context, error.message, explicit));
    }
    throw error;
  };

  let measure: Measure | undefined;
  let source: VllmFitReport["source"];
  let modelContext: number | undefined;
  if (options.configured) {
    const context = options.configured;
    measure = await launch(context).catch((error) => failed(error, context, true));
    if (measure.concurrency < n) throw new VllmFitFailure(vllmExplicitMessage(model, n, measure));
    source = "settings";
  } else {
    const measures: Measure[] = [];
    if (options.hint) {
      const hint = options.hint;
      log(`Trying the context that fitted these settings before: ${hint} tokens.`);
      try {
        measures.push(await launch(hint));
      } catch (error) {
        if (!(error instanceof VllmStopped)) throw error;
        log(`vLLM did not start with the cached context (${error.message}); fitting again.`);
      }
    }
    if (measures.length === 0) {
      measures.push(await launch("auto").catch((error) => failed(error, "auto", false)));
      modelContext = autoFitModelContext(server.output());
    }
    measure = measures.at(-1) as Measure;
    source = options.hint && measures.length === 1 && loads === 1 ? "cache" : "search";
    const floor = floorContext(modelContext);
    for (let restarts = 0; measure.concurrency < n; restarts++) {
      const target = nextContext(measures, n);
      if (target < floor) throw new VllmFitFailure(vllmFloorMessage(model, n, floor, measure));
      if (restarts === MAX_RESTARTS) {
        throw new VllmFitFailure(vllmUnfitMessage(model, n, loads, measure));
      }
      log(
        `vLLM's cache holds ${measure.concurrency.toFixed(2)} requests of ${measure.contextLength} tokens, fewer than ${n}: restarting it with ${target}.`,
      );
      measure = await launch(target).catch((error) => failed(error, target, false));
      measures.push(measure);
      source = "search";
    }
    if (measure.contextLength < floor) {
      throw new VllmFitFailure(vllmFloorMessage(model, n, floor, measure));
    }
  }
  await probe(server, model, options.toolCallParser, log);
  return {
    engine: "vllm",
    contextLength: measure.contextLength,
    modelContextLength: modelContext,
    requestedParallel: n,
    parallel: n,
    concurrency: measure.concurrency,
    cacheTokens: measure.cacheTokens,
    source,
    loads,
    toolCallParser: options.toolCallParser,
  };
}

/** Tries of the probe before it fails the start. */
const PROBE_TRIES = 2;

/**
 * Asks vLLM for a call of a `ping` tool, as an agent's request would offer one; fails the start
 * when no try returns a parsed tool call, which a parser that does not match the model gives.
 */
export async function probe(
  server: Pick<VllmServer, "url" | "fetch">,
  model: string,
  parser: string,
  log: (message: string) => void,
): Promise<void> {
  const fetchFn = server.fetch ?? fetch;
  let detail = "no answer";
  for (let attempt = 1; attempt <= PROBE_TRIES; attempt++) {
    try {
      const response = await fetchFn(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Call the ping tool now, with no arguments." }],
          tools: [
            {
              type: "function",
              function: {
                name: "ping",
                description: "Checks that tools work. Takes no arguments.",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: "auto",
          max_tokens: 4096,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(5 * 60_000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        choices?: { message?: { tool_calls?: { function?: { name?: unknown } }[] | null } }[];
      };
      const calls = body.choices?.[0]?.message?.tool_calls ?? [];
      if (response.ok && calls.some((call) => call.function?.name === "ping")) {
        log(`vLLM returned a tool call with the parser ${parser}.`);
        return;
      }
      detail = response.ok
        ? "it answered without a parsed tool call"
        : `it answered ${response.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    log(`The probe of tool calls failed (try ${attempt} of ${PROBE_TRIES}): ${detail}.`);
  }
  throw new VllmFitFailure(vllmProbeMessage(model, parser, detail));
}
