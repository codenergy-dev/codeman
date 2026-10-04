import type { Server } from "node:http";
import { Gateway, sha256 } from "../gateway/gateway.ts";
import type { GatewayUsage } from "../gateway/usage.ts";
import type { InferenceEngine } from "./engine.ts";
import { parseHandle } from "./selfhosted.ts";

/** What the sandboxed agent gets to reach its model. It never holds a provider's own key. */
export interface AgentAccess {
  /** The agent's credential: an OpenRouter key, or a gateway's run token. */
  apiKey: string;
  /** The OpenAI-compatible API to call; undefined for the harness's own provider. */
  baseUrl?: string | undefined;
  contextLength?: number | undefined;
  /** Stops what the agent job started for the run, and reports what it measured. */
  finish(): Promise<GatewayUsage | undefined>;
}

/** What the agent job knows about the run, from the key job's outputs and its own secrets. */
export interface AccessInputs {
  mode: "openrouter" | "pod" | "serverless";
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
  if (inputs.mode === "openrouter") return { apiKey: inputs.credential, finish: done };
  if (inputs.mode === "pod") {
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
  const gateway = new Gateway({
    upstream: handle.url,
    upstreamHeaders: { Authorization: `Bearer ${inputs.serverlessKey}` },
    engine: inputs.engine,
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
  return {
    apiKey: inputs.credential,
    baseUrl: `${url}/v1`,
    contextLength: handle.contextLength,
    finish: async () => {
      const usage = gateway.endRun();
      await close(server);
      return usage;
    },
  };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
