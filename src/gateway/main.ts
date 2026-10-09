import { type ChildProcess, spawn } from "node:child_process";
import { OLLAMA_URL, ollama } from "../inference/ollama.ts";
import { Runpod } from "../inference/runpod.ts";
import { Gateway } from "./gateway.ts";
import { expiry, GATEWAY_PORT, ollamaServeEnvironment, podSettings, prepareOllama } from "./pod.ts";

/**
 * The pod's entry point, in Codeman's pod image: serves the model through the gateway, and
 * terminates the pod when it is no longer useful. Runs as `node gateway.js`.
 */
async function main(): Promise<void> {
  const settings = podSettings(process.env);
  const log = (message: string) => console.log(`[codeman] ${message}`);
  let ollamaProcess: ChildProcess | undefined;
  const terminate = async (reason: string): Promise<never> => {
    log(`Terminating the pod: ${reason}.`);
    if (settings.podId && settings.podKey) {
      await new Runpod(settings.podKey).pods.terminate(settings.podId).catch((error: unknown) => {
        log(`Could not terminate the pod: ${error instanceof Error ? error.message : error}`);
      });
    }
    ollamaProcess?.kill("SIGTERM");
    // Should the provider not terminate it, the container stops when its main process exits.
    process.exit(0);
  };

  // A pod restarted after its first start must not serve again, nor pull the model again.
  if (Date.now() >= settings.policy.startBy) await terminate("it started after its start limit");
  // A requested setting is never dropped: a pod that cannot read them does not serve.
  if (!settings.ollama.ok) {
    await terminate(`its Ollama settings cannot be applied: ${settings.ollama.error}`);
  }
  const variables = settings.ollama.ok ? settings.ollama.value : {};
  const names = Object.entries(variables).map(([name, value]) => `${name}=${value}`);
  if (names.length > 0) log(`Ollama settings: ${names.join(", ")}.`);

  const gateway = new Gateway({
    upstream: `${OLLAMA_URL}/v1`,
    engine: ollama,
    adminSha256: settings.adminSha256,
    log,
  });
  gateway.ollama = variables;
  await gateway.listen("0.0.0.0", GATEWAY_PORT);
  log(`Gateway listening on port ${GATEWAY_PORT}.`);

  ollamaProcess = serve(variables, undefined);
  setInterval(() => {
    const reason = expiry(gateway, settings.policy, Date.now());
    if (reason) void terminate(reason);
    // Some runs go on: those spent or silent stop alone, and stop costing the others.
    else gateway.expireRuns(settings.policy.runIdleMs);
  }, 15_000).unref();

  try {
    gateway.contextLength = await prepareOllama(
      {
        url: OLLAMA_URL,
        restart: async (contextLength) => {
          await stop(ollamaProcess);
          ollamaProcess = serve(variables, contextLength);
        },
      },
      settings.model,
      log,
      Number(variables.OLLAMA_CONTEXT_LENGTH) || undefined,
    );
    gateway.ready = true;
    gateway.lastActivity = Date.now();
    log("Ready.");
  } catch (error) {
    await terminate(
      `the model could not be served: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** Starts `ollama serve` on the loopback, keeping models loaded, with the pod's Ollama settings. */
function serve(
  variables: Readonly<Record<string, string>>,
  contextLength: number | undefined,
): ChildProcess {
  return spawn("ollama", ["serve"], {
    stdio: "inherit",
    env: ollamaServeEnvironment(process.env, variables, contextLength),
  });
}

function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

await main();
