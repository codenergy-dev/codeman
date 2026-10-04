import { ollamaContextLength } from "../inference/ollama.ts";

/** The port a pod exposes, to the gateway; Ollama's own port stays on the pod's loopback. */
export const GATEWAY_PORT = 8080;

/** When a pod terminates itself. See docs/architecture.md#self-hosted-inference. */
export interface PodPolicy {
  /** The model must be served by then, in milliseconds since the epoch. */
  startBy: number;
  /** A kept pod, between runs of its task, waits this long for the next run. */
  keptIdleMs: number;
  /** A run without requests for this long has lost its agent. */
  runIdleMs: number;
}

/** What the gateway knows that decides whether the pod is still useful. */
export interface PodState {
  ready: boolean;
  serving: boolean;
  /** When the current run's budget is spent. */
  deadline: number | undefined;
  lastActivity: number;
}

/** Why the pod should terminate itself now, or undefined while it is useful. */
export function expiry(state: PodState, policy: PodPolicy, now: number): string | undefined {
  if (!state.ready) {
    return now >= policy.startBy ? "the model was not served in time" : undefined;
  }
  if (state.serving) {
    if (state.deadline !== undefined && now >= state.deadline) return "the run's budget is spent";
    if (now - state.lastActivity >= policy.runIdleMs) return "the run made no request for too long";
    return undefined;
  }
  return now - state.lastActivity >= policy.keptIdleMs ? "no run came to use it" : undefined;
}

/** The pod's settings, from the environment Codeman created it with. */
export interface PodSettings {
  model: string;
  adminSha256: string;
  policy: PodPolicy;
  /** The provider's ID of this pod, and a key that may terminate it. */
  podId: string | undefined;
  podKey: string | undefined;
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
    adminSha256,
    policy: { startBy, keptIdleMs: keptIdle * 60_000, runIdleMs: runIdle * 60_000 },
    podId: env.RUNPOD_POD_ID,
    podKey: env.RUNPOD_API_KEY,
  };
}

/** Ollama's server as the pod runs it: started, or restarted with a context length. */
export interface OllamaServer {
  url: string;
  restart(contextLength: number | undefined): Promise<void>;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Pulls the model, restarts Ollama with the model's own context length (its default depends on
 * the GPU's memory), and loads the model so the first request does not wait for it. Returns the
 * context length. See docs/web/ollama/.
 */
export async function prepareOllama(
  server: OllamaServer,
  model: string,
  log: (message: string) => void,
): Promise<number | undefined> {
  const call = async (path: string, body: unknown): Promise<unknown> => {
    const response = await (server.fetch ?? fetch)(`${server.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Ollama ${path} failed with ${response.status}.`);
    return response.json();
  };
  await untilUp(server);
  log(`Pulling ${model}.`);
  await call("/api/pull", { model, stream: false });
  const contextLength = ollamaContextLength(await call("/api/show", { model }));
  log(`Serving ${model} with a context length of ${contextLength ?? "Ollama's default"}.`);
  await server.restart(contextLength);
  await untilUp(server);
  await call("/api/generate", { model, keep_alive: -1 });
  return contextLength;
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
