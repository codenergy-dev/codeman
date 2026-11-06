import { createHash, randomBytes } from "node:crypto";
import { ACTION_ROOT, type GatewayArtifact, gatewayArtifact } from "../../src/action.ts";
import { BOOTSTRAP_VARIABLES, bootstrapCommand } from "../../src/gateway/bootstrap.ts";
import { GATEWAY_VERSION } from "../../src/gateway/gateway.ts";
import type { FitReport } from "../../src/gateway/pod.ts";
import type { VllmFitReport } from "../../src/gateway/vllm.ts";
import type { InferenceEngine } from "../../src/inference/engine.ts";
import { ENGINES } from "../../src/inference/engines.ts";
import {
  type GpuProvider,
  type Pod,
  type PodHost,
  type PodSpec,
  PodStartFailure,
  PodUnavailable,
} from "../../src/inference/gpu.ts";
import { ENGINE_RELEASES, NODE_RELEASE, podImage } from "../../src/inference/images.ts";
import { Osv } from "../../src/inference/osv.ts";
import { type OpenedRun, OpenFailure, ProfileUnavailable } from "../../src/inference/provider.ts";
import { isBlocking, MemoryReleaseCheckCache } from "../../src/inference/release-policy.ts";
import { type PodReleases, ReleaseBlocked } from "../../src/inference/resolution.ts";
import { Runpod } from "../../src/inference/runpod.ts";
import {
  adminToken,
  type PodHandle,
  PodInference,
  type PodSettings,
} from "../../src/inference/selfhosted.ts";
import { checkedVllm, isHuggingFaceId, VLLM_MIN_CUDA } from "../../src/inference/vllm.ts";
import type { Pool } from "../../src/pool.ts";
import type { Log } from "../../src/runtime/runtime.ts";
import { MemoryStore } from "../../src/store/memory.ts";
import { type Fields, Report } from "./report.ts";

/**
 * The pod check (step 3 of the plan to run the e2e suite on GitHub's runners): Codeman's real
 * self-hosted path, `PodInference` with the real `Runpod` and the real release policy, starts a
 * pod on a real GPU from each engine's official image through the bootstrap, checks it, and
 * terminates it. It runs from the sources with Node, so no redirect of the e2e build applies, and
 * keeps its pod registry in memory. See docs/development/e2e/suite.md#the-pod-check.
 */

/**
 * The organization the check's pods name in `CODEMAN_ORGANIZATION`, which no real organization
 * uses: Codeman's sweep and `--cleanup` touch only pods that carry it.
 */
export const OWNER = "codeman-pod-check";

/**
 * The GPU types the check may use: small, cheap ones, which hold the tiny models. Runpod's IDs
 * (docs/web/runpod/gpu-types.md).
 */
export const GPU_TYPES: readonly string[] = [
  "NVIDIA RTX A4000",
  "NVIDIA RTX A4500",
  "NVIDIA RTX A5000",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA L4",
  "NVIDIA RTX 4000 Ada Generation",
];
export const DEFAULT_GPU = "NVIDIA GeForce RTX 4090";

/** Runpod's REST API, as the adapter calls it (src/inference/runpod.ts). */
const RUNPOD_API = "https://api.runpod.io/v2";

/** The most one run may cost, in USD: the GPU's price for the run's whole time, pods one at a time. */
export const MAX_RUN_USD = 1;
/** The run's time bound, in minutes: when reached, it stops and terminates its pods. */
export const DEFAULT_MINUTES = 60;
const MIN_MINUTES = 15;

/**
 * What the check can run: a pod that serves on Ollama, one on vLLM, a release the policy blocks
 * (no pod), and a vLLM pod whose model does not fit the GPU (step 4 of the plan).
 */
export const CHECKS = ["ollama", "vllm", "blocked", "unfit"] as const;
export type CheckName = (typeof CHECKS)[number];
export const DEFAULT_CHECKS: readonly CheckName[] = ["ollama", "vllm"];

/** The tiny public models of the e2e suite. */
export const DEFAULT_MODELS = { ollama: "qwen2.5:0.5b", vllm: "Qwen/Qwen2.5-0.5B-Instruct" };
/** vLLM's tool call parser for Qwen2.5, as the e2e suite's vLLM scenarios set it. */
const TOOL_CALL_PARSER = "hermes";
/**
 * vLLM settings no GPU of `GPU_TYPES` holds: 256 requests of 32,768 tokens of Qwen2.5-0.5B's
 * K/V cache, at 12 KiB per token, are about 100 GB. vLLM starts, and the gateway's fit refuses.
 */
const UNFIT_VLLM = { "max-model-len": "32768", "max-num-seqs": "256" };

/** Ollama's model names: `name`, `namespace/name`, each with an optional `:tag`. */
const OLLAMA_MODEL =
  /^[a-z0-9][a-z0-9._-]{0,62}(\/[a-z0-9][a-z0-9._-]{0,62})?(:[A-Za-z0-9][A-Za-z0-9._-]{0,62})?$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
/** A Runpod API key, as far as the check needs to tell: printable, without spaces. */
const API_KEY = /^[\x21-\x7e]{16,512}$/;

/** Each option, as `--<name>=<value>` or in its environment variable; the argument wins. */
const OPTIONS = {
  gpu: "CODEMAN_POD_CHECK_GPU",
  checks: "CODEMAN_POD_CHECK_CHECKS",
  "ollama-model": "CODEMAN_POD_CHECK_OLLAMA_MODEL",
  "vllm-model": "CODEMAN_POD_CHECK_VLLM_MODEL",
  "max-minutes": "CODEMAN_POD_CHECK_MAX_MINUTES",
} as const;
type Option = keyof typeof OPTIONS;

export interface Inputs {
  gpu: string;
  checks: CheckName[];
  ollamaModel: string;
  vllmModel: string;
  maxMinutes: number;
  /** Only terminate every pod that names `OWNER`, as a workflow's last step does. */
  cleanup: boolean;
}

/**
 * The check's inputs, each checked against a strict pattern before use. A problem never repeats
 * the value given: an input could hold anything, workflow commands included.
 */
export function parseInputs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { inputs: Inputs } | { problem: string } {
  const given = new Map<Option, string>();
  let cleanup = false;
  for (const arg of argv) {
    if (arg === "--cleanup") {
      cleanup = true;
      continue;
    }
    const match = /^--([a-z-]+)=([\s\S]*)$/.exec(arg);
    const name = match?.[1] as Option | undefined;
    if (!match || !name || !(name in OPTIONS) || given.has(name)) {
      return {
        problem: `Unknown or repeated argument; the options are --cleanup, ${Object.keys(OPTIONS)
          .map((option) => `--${option}=`)
          .join(", ")}.`,
      };
    }
    given.set(name, match[2] as string);
  }
  const value = (name: Option): string | undefined => {
    const text = given.get(name) ?? env[OPTIONS[name]];
    return text === undefined || text.trim() === "" ? undefined : text.trim();
  };
  const gpu = value("gpu") ?? DEFAULT_GPU;
  if (!GPU_TYPES.includes(gpu)) {
    return { problem: `The GPU type must be one of: ${GPU_TYPES.join(", ")}.` };
  }
  const listed = value("checks")
    ?.split(",")
    .map((check) => check.trim()) ?? [...DEFAULT_CHECKS];
  if (
    listed.length === 0 ||
    new Set(listed).size !== listed.length ||
    !listed.every((check) => (CHECKS as readonly string[]).includes(check))
  ) {
    return { problem: `The checks must be a list of ${CHECKS.join(", ")}, each once.` };
  }
  const ollamaModel = value("ollama-model") ?? DEFAULT_MODELS.ollama;
  if (!OLLAMA_MODEL.test(ollamaModel)) {
    return { problem: "The Ollama model must be an Ollama name, such as qwen2.5:0.5b." };
  }
  const vllmModel = value("vllm-model") ?? DEFAULT_MODELS.vllm;
  if (vllmModel.length > 96 || !isHuggingFaceId(vllmModel)) {
    return {
      problem: "The vLLM model must be a Hugging Face ID, such as Qwen/Qwen2.5-0.5B-Instruct.",
    };
  }
  const minutes = value("max-minutes") ?? String(DEFAULT_MINUTES);
  const maxMinutes = Number(minutes);
  if (!/^\d{1,3}$/.test(minutes) || maxMinutes < MIN_MINUTES || maxMinutes > DEFAULT_MINUTES) {
    return {
      problem: `The max minutes must be a whole number from ${MIN_MINUTES} to ${DEFAULT_MINUTES}.`,
    };
  }
  return {
    inputs: { gpu, checks: listed as CheckName[], ollamaModel, vllmModel, maxMinutes, cleanup },
  };
}

/**
 * The commit whose gateway the pods download: `GITHUB_SHA` in GitHub Actions, which is the commit
 * `actions/checkout` checks out, and so the one `actionCommit` reads in Codeman's own jobs; else
 * the checkout's `HEAD`. Undefined when neither is a full SHA.
 */
export function runCommit(
  env: Readonly<Record<string, string | undefined>>,
  git: () => string,
): string | undefined {
  let commit = env.GITHUB_SHA?.trim() ?? "";
  if (commit === "") {
    try {
      commit = git().trim();
    } catch {
      return undefined;
    }
  }
  return FULL_SHA.test(commit) ? commit : undefined;
}

export interface CheckOptions {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  /** Writes one line to the standard output. */
  write: (line: string) => void;
  /** `git rev-parse HEAD`, when `GITHUB_SHA` is unset. */
  git: () => string;
  fetch?: typeof fetch;
  /** Stops the run, as SIGINT and SIGTERM do: its pods are terminated all the same. */
  signal?: AbortSignal;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
  /** Codeman's checkout, whose `dist/gateway.js` the pods download from the commit. */
  root?: string;
}

/** Runs the pod check, and gives its exit code: 0 when every check and the cleanup pass. */
export async function podCheck(options: CheckOptions): Promise<number> {
  const { env } = options;
  const report = new Report(options.write, env.GITHUB_ACTIONS === "true");
  const key = env.CODEMAN_RUNPOD_API_KEY ?? "";
  // Masked before anything else, though GitHub masks a secret already.
  report.hide(key);
  const parsed = parseInputs(options.argv, env);
  if ("problem" in parsed) {
    report.line("inputs", { result: "fail", reason: parsed.problem });
    return 2;
  }
  if (!API_KEY.test(key)) {
    report.line("inputs", {
      result: "fail",
      reason: "CODEMAN_RUNPOD_API_KEY must hold a Runpod API key.",
    });
    return 2;
  }
  const { inputs } = parsed;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const runpod = new Runpod(key, fetchFn, now);
  if (inputs.cleanup) return cleanupAll(report, runpod.pods);
  report.line("inputs", {
    result: "pass",
    gpu: inputs.gpu,
    checks: inputs.checks.join(","),
    max_minutes: inputs.maxMinutes,
  });

  const commit = runCommit(env, options.git);
  if (!commit) {
    report.line("gateway", {
      result: "fail",
      reason: "The run's commit is unknown: set GITHUB_SHA, or run from a git checkout.",
    });
    return 1;
  }
  const gateway = await servedGateway(fetchFn, options.root ?? ACTION_ROOT, commit);
  report.line("gateway", { result: gateway.ok ? "pass" : "fail", commit, reason: gateway.reason });
  if (!gateway.ok) return 1;

  const started = now().getTime();
  let memoryGb: number | undefined;
  try {
    const hourly = (await runpod.pods.price(inputs.gpu, "secure")) * 3600;
    memoryGb = await runpod.pods.memory(inputs.gpu);
    const worst = (hourly * inputs.maxMinutes) / 60;
    const within = worst <= MAX_RUN_USD;
    report.line("gpu", {
      result: within ? "pass" : "fail",
      gpu: inputs.gpu,
      memory_gb: memoryGb,
      price_per_hour_usd: hourly,
      worst_case_usd: worst,
      reason: within
        ? undefined
        : `Its price for the run's max minutes is above ${MAX_RUN_USD} USD: lower the max minutes, or choose a cheaper GPU type.`,
    });
    if (!within) return 1;
  } catch (error) {
    report.line("gpu", { result: "fail", gpu: inputs.gpu, ...failure(report, error) });
    return 1;
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), inputs.maxMinutes * 60_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const tag = runTag(env);
  const pods = new TrackedPods(runpod.pods, report, key, signal, now, wait);
  const context: Context = {
    report,
    say: (event, fields) => {
      if (!signal.aborted) report.line(event, fields);
    },
    key,
    inputs,
    gateway: gateway.artifact,
    pods,
    store: new MemoryStore(),
    pool: { id: `${OWNER}-${tag}`, members: [OWNER] },
    releases: {
      gateway: () => gateway.artifact,
      osv: new Osv(fetchFn),
      cache: new MemoryReleaseCheckCache(),
    },
    fetch: fetchFn,
    now,
    wait: options.wait,
    memoryGb,
    runId: tag,
  };
  const results: boolean[] = [];
  try {
    for (const check of inputs.checks) {
      if (signal.aborted) break;
      try {
        results.push(await untilStopped(runCheck(context, check), signal));
      } catch (error) {
        results.push(false);
        if (error instanceof Stopped) {
          report.line(check, {
            result: "stopped",
            reason: deadline.signal.aborted
              ? "The run reached its max minutes."
              : "The run was interrupted.",
          });
          break;
        }
        report.line(check, { result: "fail", ...failure(report, error) });
      }
    }
  } finally {
    clearTimeout(timer);
    const cleanup = await pods.cleanup(context.pool.id);
    report.line("cleanup", {
      result: cleanup.ok ? "pass" : "fail",
      pods: cleanup.pods,
      leftover_pods: cleanup.leftovers,
    });
    results.push(cleanup.ok);
  }
  const passed = results.length > inputs.checks.length && results.every(Boolean);
  report.line("done", {
    result: passed ? "pass" : "fail",
    total_s: seconds(started, now().getTime()),
  });
  return passed ? 0 : 1;
}

/** What one check needs. */
interface Context {
  report: Report;
  /** Prints a line, unless the run was stopped: work that lost the race prints nothing. */
  say: (event: string, fields: Fields) => void;
  key: string;
  inputs: Inputs;
  gateway: GatewayArtifact;
  pods: TrackedPods;
  store: MemoryStore;
  pool: Pool;
  releases: PodReleases;
  fetch: typeof fetch;
  now: () => Date;
  wait: ((ms: number) => Promise<void>) | undefined;
  memoryGb: number | undefined;
  runId: string;
}

function runCheck(context: Context, check: CheckName): Promise<boolean> {
  switch (check) {
    case "ollama":
    case "vllm":
      return serveCheck(context, check);
    case "blocked":
      return blockedCheck(context);
    case "unfit":
      return unfitCheck(context);
  }
}

/** What Codeman logs: nothing is printed, since its lines name pods. */
const SILENT: Log = { info: () => {}, warning: () => {}, error: () => {} };

/** The run each check opens: one task, with a limit the gateway will not reach. */
function runRequest(context: Context) {
  return {
    task: "1",
    runId: context.runId,
    limit: MAX_RUN_USD,
    reservationMs: context.inputs.maxMinutes * 60_000,
  };
}

/** Codeman's self-hosted inference on a pod of the engine, as `open-key` builds it. */
function podInference(
  context: Context,
  engine: "ollama" | "vllm",
  vllm: Record<string, string> = {},
  releases: PodReleases = context.releases,
): PodInference {
  const settings: PodSettings = {
    model: engine === "ollama" ? context.inputs.ollamaModel : context.inputs.vllmModel,
    engine: ENGINES[engine] as InferenceEngine,
    pods: [],
    gpuType: context.inputs.gpu,
    image: podImage(engine),
    reuse: "run",
    parallel: 1,
    ...(engine === "vllm"
      ? { vllm: checkedVllm({ "tool-call-parser": TOOL_CALL_PARSER, ...vllm }) }
      : {}),
  };
  return new PodInference(settings, {
    repository: { owner: OWNER, name: "pod-check" },
    gpu: context.pods.provider,
    account: { key: context.key },
    store: context.store,
    pool: context.pool,
    now: context.now,
    fetch: context.fetch,
    ...(context.wait ? { wait: context.wait } : {}),
    releases,
  });
}

/**
 * A pod that serves: its start, then that the bootstrap verified Node.js and the gateway, the
 * gateway's health, the fit against the GPU, one chat answer through Runpod's proxy, and its end.
 */
async function serveCheck(context: Context, engine: "ollama" | "vllm"): Promise<boolean> {
  const { say } = context;
  const model = engine === "ollama" ? context.inputs.ollamaModel : context.inputs.vllmModel;
  const inference = podInference(context, engine);
  const room = await availability(context, engine);
  const start = context.now().getTime();
  context.pods.allowCreate = true;
  let opened: OpenedRun;
  try {
    opened = await inference.open(runRequest(context), SILENT);
  } catch (error) {
    say(`${engine}.start`, {
      ...startFailure(context.report, error, room),
      engine,
      model,
      ...room,
      pods: context.pods.count,
    });
    return false;
  } finally {
    context.pods.allowCreate = false;
  }
  context.report.hide(opened.credential);
  const handle = JSON.parse(opened.handle) as PodHandle;
  context.report.hide(handle.podId);
  context.report.hide(handle.url);
  context.report.hide(handle.nonce);
  const serving = context.now().getTime();
  const created = context.pods.createdAt(handle.nonce) ?? start;
  say(`${engine}.start`, {
    result: "pass",
    engine,
    model,
    ...room,
    create_s: seconds(start, created),
    serve_s: seconds(created, serving),
  });
  const results: boolean[] = [];
  try {
    const status = await adminStatus(context, handle).catch(() => undefined);
    const bootstrap = bootstrapFields(context, handle.nonce, engine, status);
    say(`${engine}.bootstrap`, bootstrap);
    results.push(bootstrap.result === "pass");
    const health = await healthFields(context, handle);
    say(`${engine}.health`, health);
    results.push(health.result === "pass");
    const fit = fitFields(context, engine, status);
    say(`${engine}.fit`, fit);
    results.push(fit.result === "pass");
    const chat = await chatFields(context, opened, model);
    say(`${engine}.chat`, chat);
    results.push(chat.result === "pass");
  } finally {
    try {
      const usage = await inference.close(opened.handle, SILENT);
      say(`${engine}.end`, {
        result: "pass",
        cost_usd: usage.cost,
        total_s: seconds(start, context.now().getTime()),
      });
      results.push(true);
    } catch (error) {
      say(`${engine}.end`, failure(context.report, error));
      results.push(false);
    }
  }
  return results.every(Boolean);
}

/**
 * A blocked release starts no pod (step 4 of the plan): Ollama's pinned release without its
 * exceptions, which OSV.dev's advisories then block. No pod may be created meanwhile.
 */
async function blockedCheck(context: Context): Promise<boolean> {
  const ollama = ENGINE_RELEASES.ollama;
  if (!ollama) throw new Error("The catalog pins no Ollama release.");
  const before = context.pods.count;
  const inference = podInference(
    context,
    "ollama",
    {},
    {
      ...context.releases,
      engines: { ...ENGINE_RELEASES, ollama: { ...ollama, exceptions: [] } },
    },
  );
  let error: unknown;
  try {
    const opened = await inference.open(runRequest(context), SILENT);
    await inference.close(opened.handle, SILENT).catch(() => undefined);
  } catch (caught) {
    error = caught;
  }
  const created = context.pods.count - before;
  const blocked = causeOf(error) instanceof ReleaseBlocked;
  const passed = blocked && created === 0;
  const { result: _, ...found } =
    error === undefined ? { result: "" } : failure(context.report, error);
  context.say("blocked", {
    result: passed ? "pass" : "fail",
    ...found,
    ...(blocked ? {} : { reason: "The release policy did not block the release." }),
    pods: created,
  });
  return passed;
}

/**
 * A model that does not fit fails with the fit's message (step 4 of the plan): a vLLM pod whose
 * explicit settings no GPU of the list holds. The pod starts, the gateway's fit refuses, and
 * Codeman terminates it.
 */
async function unfitCheck(context: Context): Promise<boolean> {
  const before = context.pods.count;
  const inference = podInference(context, "vllm", UNFIT_VLLM);
  const room = await availability(context, "vllm");
  const start = context.now().getTime();
  context.pods.allowCreate = true;
  let error: unknown;
  try {
    const opened = await inference.open(runRequest(context), SILENT);
    await inference.close(opened.handle, SILENT).catch(() => undefined);
  } catch (caught) {
    error = caught;
  } finally {
    context.pods.allowCreate = false;
  }
  const cause = causeOf(error);
  const fit =
    cause instanceof PodStartFailure && /does not fit the GPU|found no context/.test(cause.message);
  const created = context.pods.count - before;
  const passed = fit && created > 0;
  const { result: _, ...found } =
    error === undefined
      ? { result: "", reason: "The pod served the model, which should not fit." }
      : startFailure(context.report, error, room);
  context.say("unfit", {
    result: passed ? "pass" : "fail",
    engine: "vllm",
    model: context.inputs.vllmModel,
    ...found,
    ...room,
    pods: created,
    total_s: seconds(start, context.now().getTime()),
  });
  return passed;
}

/** What the gateway says of itself, from `/admin/status` (src/gateway/gateway.ts). */
interface GatewayStatus {
  version?: unknown;
  engine?: unknown;
  ready?: unknown;
  /** The Node.js the gateway runs on, and its own file's SHA-256: from pod gateways that say. */
  node?: unknown;
  gatewaySha256?: unknown;
  fit?: FitReport | VllmFitReport;
}

/** The gateway's status, with the admin token the account key derives for the pod. */
async function adminStatus(context: Context, handle: PodHandle): Promise<GatewayStatus> {
  const response = await context.fetch(`${handle.url}/admin/status`, {
    headers: { Authorization: `Bearer ${adminToken(context.key, handle.nonce)}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The gateway answered ${response.status}.`);
  }
  return (await response.json()) as GatewayStatus;
}

/**
 * That the bootstrap verified Node.js and the gateway: the gateway reports the Node.js it runs on
 * and its own file's SHA-256 (`gatewayBuild` in src/gateway/gateway.ts), which must be
 * `NODE_RELEASE`'s version and the gateway's at the run's commit. The bootstrap runs nothing
 * whose SHA-256 differs, so they prove what it checked. Also checked: the pod was created with
 * the bootstrap as its command, on the catalog's image, with `NODE_RELEASE`'s URL and SHA-256 and
 * the gateway's at the run's commit; and the gateway answers with its version and engine.
 */
function bootstrapFields(
  context: Context,
  nonce: string,
  engine: "ollama" | "vllm",
  status: GatewayStatus | undefined,
): Fields {
  const spec = context.pods.spec(nonce);
  const env = spec?.env ?? {};
  const command = JSON.stringify(spec?.command) === JSON.stringify(bootstrapCommand());
  const image = spec?.image === podImage(engine);
  const nodeSpec =
    env[BOOTSTRAP_VARIABLES.nodeUrl] === NODE_RELEASE.url &&
    env[BOOTSTRAP_VARIABLES.nodeSha256] === NODE_RELEASE.sha256;
  const gatewaySpec =
    env[BOOTSTRAP_VARIABLES.gatewayUrl] === context.gateway.url &&
    env[BOOTSTRAP_VARIABLES.gatewaySha256] === context.gateway.sha256;
  const answered = status?.version === GATEWAY_VERSION && status.engine === engine;
  const node = typeof status?.node === "string" ? status.node : undefined;
  const nodeMatch = node === `v${NODE_RELEASE.release.version}`;
  const gatewayMatch = status?.gatewaySha256 === context.gateway.sha256;
  const passed = command && image && nodeSpec && gatewaySpec && answered && nodeMatch;
  return {
    result: passed && gatewayMatch ? "pass" : "fail",
    node,
    node_match: nodeMatch,
    gateway_sha256_match: gatewayMatch,
    command,
    image,
    node_spec: nodeSpec,
    gateway_spec: gatewaySpec,
    gateway_answered: answered,
    gateway_version: typeof status?.version === "number" ? status.version : undefined,
  };
}

/** `/health` through Runpod's proxy: ready. */
async function healthFields(context: Context, handle: PodHandle): Promise<Fields> {
  try {
    const response = await context.fetch(`${handle.url}/health`, {
      signal: AbortSignal.timeout(30_000),
    });
    const body = await jsonBody<{ ready?: unknown }>(response);
    const ready = body?.ready === true;
    return { result: ready ? "pass" : "fail", http_status: response.status, ready };
  } catch (error) {
    return { result: "fail", ...failure(context.report, error) };
  }
}

/**
 * How the model fits the GPU, from the gateway's status, against the GPU's memory as Runpod lists
 * it. Ollama reports the bytes its model uses on the GPU (`/api/ps`'s `size_vram`); vLLM, the
 * tokens its K/V cache holds.
 */
function fitFields(
  context: Context,
  engine: "ollama" | "vllm",
  status: GatewayStatus | undefined,
): Fields {
  const fit = status?.fit;
  const gpu = context.memoryGb;
  if (engine === "ollama") {
    if (!fit || fit.engine !== undefined) {
      return { result: "fail", reason: "The gateway reported no fit.", gpu_memory_gb: gpu };
    }
    const onGpu = fit.size > 0 && fit.sizeVram >= fit.size;
    const within = gpu === undefined || fit.sizeVram <= gpu * 1e9;
    return {
      result: onGpu && within ? "pass" : "fail",
      gpu_memory_gb: gpu,
      size_gb: fit.size / 1e9,
      vram_gb: fit.sizeVram / 1e9,
      context: fit.contextLength,
      parallel: fit.parallel,
      requested_parallel: fit.requestedParallel,
      source: fit.source,
      loads: fit.loads,
    };
  }
  if (fit?.engine !== "vllm") {
    return { result: "fail", reason: "The gateway reported no fit.", gpu_memory_gb: gpu };
  }
  return {
    result:
      fit.concurrency >= fit.parallel && fit.cacheTokens >= fit.contextLength ? "pass" : "fail",
    gpu_memory_gb: gpu,
    context: fit.contextLength,
    model_context: fit.modelContextLength,
    cache_tokens: fit.cacheTokens,
    concurrency: fit.concurrency,
    parallel: fit.parallel,
    source: fit.source,
    loads: fit.loads,
  };
}

/** A successful response's JSON body, never printed; undefined for another status. */
async function jsonBody<T>(response: Response): Promise<T | undefined> {
  if (!response.ok) {
    await response.body?.cancel();
    return undefined;
  }
  return (await response.json().catch(() => undefined)) as T | undefined;
}

/** One chat completion through Runpod's proxy, with the run's token: a status, never the body. */
async function chatFields(context: Context, opened: OpenedRun, model: string): Promise<Fields> {
  const start = context.now().getTime();
  try {
    const response = await context.fetch(`${opened.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opened.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with one word: ready." }],
        max_tokens: 16,
      }),
      // Runpod's proxy cuts a request at 100 seconds.
      signal: AbortSignal.timeout(120_000),
    });
    const body = await jsonBody<{
      choices?: { message?: { content?: unknown } }[];
      usage?: { completion_tokens?: unknown };
    }>(response);
    const content = body?.choices?.[0]?.message?.content;
    const answered = typeof content === "string" && content.trim() !== "";
    const tokens = body?.usage?.completion_tokens;
    return {
      result: response.ok && answered ? "pass" : "fail",
      http_status: response.status,
      answered,
      completion_tokens: typeof tokens === "number" ? tokens : undefined,
      chat_s: seconds(start, context.now().getTime()),
    };
  } catch (error) {
    return { result: "fail", ...failure(context.report, error) };
  }
}

/**
 * The gateway the pods download, checked before any pod: `gatewayArtifact`, as `open-key` gives
 * it, at the run's commit, and its file on raw.githubusercontent.com, whose SHA-256 must be that
 * of the checkout's `dist/gateway.js`. A commit not pushed, or a `dist/` changed since it, would
 * fail every pod's bootstrap.
 */
async function servedGateway(
  fetchFn: typeof fetch,
  root: string,
  commit: string,
): Promise<
  { ok: true; artifact: GatewayArtifact; reason?: undefined } | { ok: false; reason: string }
> {
  let artifact: GatewayArtifact;
  try {
    artifact = gatewayArtifact(root, commit);
  } catch {
    return { ok: false, reason: "The checkout has no dist/gateway.js to give the pods." };
  }
  try {
    const response = await fetchFn(artifact.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        reason: `raw.githubusercontent.com answered ${response.status} for the commit's dist/gateway.js: push the commit first.`,
      };
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(body).digest("hex") !== artifact.sha256) {
      return {
        ok: false,
        reason:
          "The commit's dist/gateway.js differs from the checkout's: run from a clean checkout of the commit.",
      };
    }
  } catch {
    return { ok: false, reason: "raw.githubusercontent.com could not be reached." };
  }
  return { ok: true, artifact };
}

/**
 * Runpod's pods, as the check gives them to Codeman: it records every pod created, with the spec
 * it was created with, refuses to create one outside a check that may, and registers each pod's
 * ID, URL, nonce and admin token as hidden as soon as it exists.
 */
class TrackedPods {
  readonly provider: GpuProvider;
  /** Whether a check may create a pod now. */
  allowCreate = false;
  readonly #host: Required<Omit<PodHost, "unservedImages">>;
  readonly #report: Report;
  readonly #key: string;
  readonly #signal: AbortSignal;
  readonly #now: () => Date;
  readonly #wait: (ms: number) => Promise<void>;
  /** The pods this run created, and when, by nonce. */
  readonly #created = new Map<string, { id: string; at: number }>();
  readonly #specs = new Map<string, PodSpec>();
  /** Pods Codeman terminated that this run did not create: earlier runs' leftovers. */
  readonly #leftovers = new Set<string>();
  #closed = false;

  constructor(
    host: Required<Omit<PodHost, "unservedImages">>,
    report: Report,
    key: string,
    signal: AbortSignal,
    now: () => Date,
    wait: (ms: number) => Promise<void>,
  ) {
    this.#host = host;
    this.#report = report;
    this.#key = key;
    this.#signal = signal;
    this.#now = now;
    this.#wait = wait;
    this.provider = {
      name: "runpod",
      pods: {
        ...host,
        create: (spec) => this.#create(spec),
        terminate: async (id) => {
          this.#report.hide(id);
          if (![...this.#created.values()].some((pod) => pod.id === id)) this.#leftovers.add(id);
          await host.terminate(id);
        },
        url: async (id, port) => {
          const url = await host.url(id, port);
          this.#report.hide(url);
          return url;
        },
      },
    };
  }

  /** How many pods this run created. */
  get count(): number {
    return this.#created.size;
  }

  createdAt(nonce: string): number | undefined {
    return this.#created.get(nonce)?.at;
  }

  spec(nonce: string): PodSpec | undefined {
    return this.#specs.get(nonce);
  }

  async #create(spec: PodSpec): Promise<Pod> {
    if (this.#closed || !this.allowCreate || this.#signal.aborted) {
      throw new Error("The pod check creates no pod now.");
    }
    const nonce = spec.env.CODEMAN_NONCE ?? "";
    // Before the pod exists, and so before any request carries it.
    this.#report.hide(adminToken(this.#key, nonce));
    this.#report.hide(nonce);
    this.#specs.set(nonce, spec);
    const pod = await this.#host.create(spec);
    this.#report.hide(pod.id);
    this.#created.set(nonce, { id: pod.id, at: this.#now().getTime() });
    if (this.#closed || this.#signal.aborted) {
      await this.#host.terminate(pod.id).catch(() => undefined);
      throw new Error("The pod check stopped.");
    }
    return pod;
  }

  /**
   * Terminates every pod of the run: those it created, and any other of its pool, such as one
   * whose creation's answer was lost; then checks that each is gone. Creates none after.
   */
  async cleanup(pool: string): Promise<{ ok: boolean; pods: number; leftovers: number }> {
    this.#closed = true;
    let ok = true;
    const ids = new Set([...this.#created.values()].map((pod) => pod.id));
    try {
      for (const pod of await this.#host.list({
        CODEMAN_ORGANIZATION: OWNER,
        CODEMAN_POOL: pool,
      })) {
        this.#report.hide(pod.id);
        ids.add(pod.id);
      }
    } catch {
      ok = false;
    }
    for (const id of ids) {
      try {
        await this.#host.terminate(id);
      } catch {
        ok = false;
      }
    }
    for (const id of ids) ok = (await this.#gone(id)) && ok;
    return { ok, pods: ids.size, leftovers: this.#leftovers.size };
  }

  /** Whether Runpod says the pod is gone, asked up to 3 times. */
  async #gone(id: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const pod = await this.#host.get(id);
        if (!pod || pod.status === "terminated") return true;
      } catch {
        // Asked again.
      }
      if (attempt < 3) await this.#wait(2_000);
    }
    return false;
  }
}

/**
 * `--cleanup`: terminates every pod of the account that names `OWNER`, as a workflow's last step,
 * `if: always()`, does after the check.
 */
async function cleanupAll(
  report: Report,
  host: Required<Omit<PodHost, "unservedImages">>,
): Promise<number> {
  let pods: Pod[];
  try {
    pods = await host.list({ CODEMAN_ORGANIZATION: OWNER });
  } catch (error) {
    report.line("cleanup", { result: "fail", ...failure(report, error) });
    return 1;
  }
  let ok = true;
  for (const pod of pods) {
    report.hide(pod.id);
    if (pod.status === "terminated") continue;
    try {
      await host.terminate(pod.id);
    } catch {
      ok = false;
    }
  }
  report.line("cleanup", { result: ok ? "pass" : "fail", pods: pods.length });
  return ok ? 0 : 1;
}

/** The run stopped: interrupted, or at its max minutes. */
class Stopped extends Error {}

/** `work`, or a `Stopped` as soon as the signal aborts; `work` goes on, unheard. */
function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new Stopped());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Stopped());
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** What an `open` failed with: the provider's error inside an `OpenFailure`. */
function causeOf(error: unknown): unknown {
  return error instanceof OpenFailure && error.cause !== undefined ? error.cause : error;
}

/** The levels of Runpod's availability; all but `NONE` mean some room. */
const AVAILABILITY = new Set(["NONE", "LOW", "MEDIUM", "HIGH"]);

/**
 * The GPU type's room for one pod on Secure Cloud now, from Runpod's catalog, with vLLM's CUDA for
 * a vLLM pod: the request the adapter makes before a creation on several clouds
 * (`#availability` in src/inference/runpod.ts), private there, so repeated here
 * (docs/web/runpod/get-a-gpu-type.md). Prints the level, and how many data centers have room;
 * `unknown` when the catalog does not say.
 */
async function availability(context: Context, engine: "ollama" | "vllm"): Promise<Fields> {
  const cuda = engine === "vllm" ? `&minCudaVersion=${encodeURIComponent(VLLM_MIN_CUDA)}` : "";
  try {
    const response = await context.fetch(
      `${RUNPOD_API}/catalog/gpus/${encodeURIComponent(context.inputs.gpu)}?include=AVAILABILITY&product=POD&cloud=SECURE${cuda}`,
      {
        headers: { Authorization: `Bearer ${context.key}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await jsonBody<{ availability?: unknown; dataCenters?: unknown }>(response);
    const level = typeof body?.availability === "string" ? body.availability : "";
    const centers = body?.dataCenters;
    const levels = (Array.isArray(centers) ? centers : Object.values(centers ?? {})).map((one) =>
      typeof one === "string" ? one : (one as { availability?: unknown } | null)?.availability,
    );
    const known = centers !== undefined && centers !== null && typeof centers === "object";
    return {
      availability: AVAILABILITY.has(level) ? level : "unknown",
      availability_http_status: response.ok ? undefined : response.status,
      data_centers: known ? levels.length : undefined,
      data_centers_with_room: known
        ? levels.filter((one) => typeof one === "string" && one !== "NONE" && AVAILABILITY.has(one))
            .length
        : undefined,
    };
  } catch {
    return { availability: "unknown" };
  }
}

/** Runpod's detail when it has no room: "There are no [longer any] instances available …". */
const NO_INSTANCES = /\bno (longer any )?instances available\b/i;

/**
 * A start's failure, as `failure` gives it, but a creation Runpod refused with 400 while its
 * catalog listed room is a failure, not a lack of room: Runpod gives no capacity no code of its
 * own, and a request that breaks a rule answers 400 too (docs/web/runpod/create-a-pod.md#errors).
 */
function startFailure(report: Report, error: unknown, room: Fields): Fields {
  const found = failure(report, error);
  const listed =
    typeof room.availability === "string" && /^(LOW|MEDIUM|HIGH)$/.test(room.availability);
  if (found.result !== "unavailable" || !listed || found.http_status !== 400) return found;
  // Runpod's own words for no room, which can follow a catalog read that listed it, as on
  // 2026-11-06: "There are no longer any instances available with the requested specifications."
  if (typeof found.message === "string" && NO_INSTANCES.test(found.message)) return found;
  return {
    ...found,
    result: "fail",
    reason:
      "Runpod refused the creation with 400 while its catalog listed room: likely a problem with the request.",
  };
}

/**
 * What a failure may print: its kind, an HTTP status it names, the fit's or the pod's start
 * failure cleaned of every hidden value, and a few known reasons. Never another message: it may
 * hold a pod's ID, or a response's body.
 */
function failure(report: Report, error: unknown): Fields {
  const cause = causeOf(error);
  if (cause instanceof ReleaseBlocked) {
    return { result: "blocked", error: "ReleaseBlocked", advisories: blockingAdvisories(cause) };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const status = /\b(?:failed with|answered) (\d{3})\b/.exec(message)?.[1];
  if (cause instanceof PodUnavailable || error instanceof ProfileUnavailable) {
    return {
      result: "unavailable",
      error: "PodUnavailable",
      http_status: status === undefined ? undefined : Number(status),
      message: report.cleanMessage(message),
    };
  }
  if (cause instanceof PodStartFailure) {
    return {
      result: "fail",
      error: "PodStartFailure",
      message: report.cleanMessage(message.replace(/^Pod \S+ did not serve \S+: /, "")),
    };
  }
  const minutes = /was not ready within (\d+) minutes/.exec(message)?.[1];
  const state = /^Pod \S+ is (failed|stopped|terminated)\.$/.exec(message)?.[1];
  const name = cause instanceof Error ? cause.constructor.name : "Error";
  return {
    result: "fail",
    error: /^[A-Za-z]{1,40}$/.test(name) ? name : "Error",
    http_status: status === undefined ? undefined : Number(status),
    // Runpod's own text about a request, such as a 400's `detail`: cleaned of every hidden value.
    message: /^Runpod /.test(message) ? report.cleanMessage(message) : undefined,
    reason: minutes
      ? `The pod did not serve within ${minutes} minutes.`
      : state
        ? `The pod was ${state} before it served.`
        : /no longer exists/.test(message)
          ? "The pod no longer exists."
          : /^Runpod offers no host .* CUDA/.test(message)
            ? "Runpod offers no host of this GPU type with the CUDA version vLLM needs."
            : /^Runpod has no GPU type/.test(message)
              ? "Runpod has no such GPU type."
              : undefined,
  };
}

/** The advisories that blocked a release: blocking ones no exception accepted. */
function blockingAdvisories(blocked: ReleaseBlocked): string | undefined {
  const ids = blocked.check.artifacts.flatMap((artifact) =>
    artifact.advisories
      .filter((advisory) => isBlocking(advisory.severity) && !advisory.acceptedBecause)
      .map((advisory) => advisory.id),
  );
  return ids.length > 0 ? [...new Set(ids)].slice(0, 20).join(",") : undefined;
}

/** The run's tag in its pool's ID: GitHub's run and attempt, else random. */
function runTag(env: Readonly<Record<string, string | undefined>>): string {
  const run = env.GITHUB_RUN_ID ?? "";
  const attempt = env.GITHUB_RUN_ATTEMPT ?? "1";
  return /^\d{1,20}$/.test(run) && /^\d{1,4}$/.test(attempt)
    ? `${run}-${attempt}`
    : randomBytes(4).toString("hex");
}

function seconds(from: number, to: number): number {
  return Math.round((to - from) / 100) / 10;
}
