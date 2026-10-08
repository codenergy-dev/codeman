import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { Gateway, sha256 } from "../gateway/gateway.ts";
import { RunpodQueue } from "../gateway/queue.ts";
import type { GatewayUsage, WorkerSample, Workers } from "../gateway/usage.ts";
import type { InferenceEngine } from "./engine.ts";
import type { ProviderName } from "./providers.ts";
import { parseHandle, START_MINUTES } from "./selfhosted.ts";

/** How often the gateway asks for the endpoint's workers, to tell billed time from a wait. */
const SAMPLE_MS = 5_000;

/** What the sandboxed agent gets to reach its model. It never holds a provider's own key. */
export interface AgentAccess {
  /** The agent's credential: an OpenRouter key, or a gateway's run token. */
  apiKey: string;
  /** The OpenAI-compatible API to call; undefined for the harness's own provider. */
  baseUrl?: string | undefined;
  contextLength?: number | undefined;
  /** Aborted, with the reason, when the run stops before the agent ends: the agent must stop. */
  stopped?: AbortSignal | undefined;
  /** Stops what the agent job started for the run, and reports what it measured. */
  finish(): Promise<GatewayUsage | undefined>;
}

/** What the agent job knows about the run, from the key job's outputs and its own secrets. */
export interface AccessInputs {
  /** The run's provider. */
  provider: ProviderName;
  /** The decrypted credential from open-key. */
  credential: string;
  /** For a pod: the gateway's API, from open-key. */
  baseUrl?: string | undefined;
  contextLength?: number | undefined;
  /** For Serverless: open-key's handle, and the endpoint's key, which only this step holds. */
  handle?: string | undefined;
  serverlessKey?: string | undefined;
  engine?: InferenceEngine | undefined;
  now?: () => number;
  /** For tests: how often to ask Runpod for a job's output, and for its workers. */
  pollMs?: number;
  sampleMs?: number;
  /** For tests: how long a request may wait with no worker before the run stops. */
  noWorkerMs?: number;
  log?: (message: string) => void;
}

/**
 * Gives the agent its access. For Serverless, starts the gateway on the loopback, outside the
 * sandbox (decision 11 of the plan): it holds the endpoint's key, which does not expire, and
 * the agent gets only the run's token, which stops working when the run ends or its budget is
 * spent.
 */
export async function agentAccess(inputs: AccessInputs): Promise<AgentAccess> {
  const done = async () => undefined;
  if (inputs.provider === "openrouter") return { apiKey: inputs.credential, finish: done };
  if (inputs.provider === "runpod-pod") {
    if (!inputs.baseUrl) throw new Error("The pod's gateway URL is missing.");
    return {
      apiKey: inputs.credential,
      baseUrl: inputs.baseUrl,
      contextLength: inputs.contextLength,
      finish: done,
    };
  }

  const handle = parseHandle(inputs.handle ?? "");
  if (handle.mode !== "serverless") throw new Error("The handle is not a Serverless run's.");
  if (!inputs.serverlessKey) throw new Error("The Serverless endpoint's key is missing.");
  if (!inputs.engine) throw new Error("The Serverless engine is missing.");
  const now = inputs.now ?? Date.now;
  // Runpod is the only Serverless provider; its queue waits for a worker as long as it takes.
  const queue = new RunpodQueue(handle.url, inputs.serverlessKey, {
    pollMs: inputs.pollMs,
    log: inputs.log,
  });
  const stop = new AbortController();
  // Decision 2 of the Serverless cost plan: no worker in a pod's start time fails the run.
  const gateway = new Gateway({
    upstream: handle.url,
    send: queue.send,
    engine: inputs.engine,
    noWorkerMs: inputs.noWorkerMs ?? START_MINUTES * 60_000,
    onStop: (reason) => stop.abort(new Error(reason)),
    now,
    log: inputs.log,
  });
  gateway.ready = true;
  gateway.startRun({
    tokenSha256: sha256(inputs.credential),
    limit: handle.limit,
    start: now(),
    meter: {
      kind: "busy",
      pricePerSecond: handle.pricePerSecond,
      idleMs: handle.idleSeconds * 1000,
    },
  });
  const { server, url } = await gateway.listen("127.0.0.1", 0);
  const sampling = sampleWorkers(
    (signal) => queue.workers(signal),
    (sample) => gateway.observe(sample),
    inputs.sampleMs ?? SAMPLE_MS,
    now,
  );
  return {
    apiKey: inputs.credential,
    baseUrl: `${url}/v1`,
    contextLength: handle.contextLength,
    stopped: stop.signal,
    finish: async () => {
      // Time after the last sample counts as billed: the idle timeout after the last request.
      await sampling();
      const usage = gateway.endRun();
      await close(server);
      // A job the agent left behind would run later, at the account's cost.
      await queue.settle();
      return usage;
    },
  };
}

/**
 * Samples the endpoint's workers every `everyMs`, the first at once, until the returned
 * function stops it. Decision 1 of the Serverless cost plan: only a worker's state tells a
 * start, which Runpod bills, from a wait without a worker, which it does not.
 */
function sampleWorkers(
  read: (signal: AbortSignal) => Promise<Workers | undefined>,
  observe: (sample: WorkerSample) => void,
  everyMs: number,
  now: () => number,
): () => Promise<void> {
  const stop = new AbortController();
  const loop = (async () => {
    while (!stop.signal.aborted) {
      const workers = await read(stop.signal);
      if (stop.signal.aborted) return;
      observe({ at: now(), workers });
      await sleep(everyMs, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  })();
  return async () => {
    stop.abort();
    await loop;
  };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
