import { E2E } from "../e2e.ts";
import { Runpod } from "../inference/runpod.ts";

/**
 * How a pod asks its provider to terminate it, from what the provider put in its environment:
 * Runpod gives each pod its ID and a key that may terminate it. Undefined on a provider that gives
 * none, such as Salad, whose only key reaches the whole account: the pod then ends by exiting,
 * which stops its container (decision 4 of the plan for Salad pods).
 */
export function providerTermination(
  env: Record<string, string | undefined>,
  runpod: (key: string) => Pick<Runpod, "pods"> = (key) =>
    // The e2e build's pods reach the fake Runpod (src/e2e.ts); the published build, Runpod.
    E2E ? E2E.gpu(new Runpod(key, E2E.fetch)) : new Runpod(key),
): (() => Promise<void>) | undefined {
  const podId = env.RUNPOD_POD_ID;
  const key = env.RUNPOD_API_KEY;
  if (!podId || !key) return undefined;
  return () => runpod(key).pods.terminate(podId);
}

/**
 * Listens on every address, IPv6 included, which Salad's Container Gateway reaches pods on; a
 * host without IPv6 gets IPv4's. `::` serves IPv4 too on Linux.
 */
export async function listenEverywhere<T>(listen: (host: string) => Promise<T>): Promise<T> {
  try {
    return await listen("::");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EAFNOSUPPORT") throw error;
    return listen("0.0.0.0");
  }
}
