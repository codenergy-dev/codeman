/**
 * How the fake Runpod gets a pod's container: it asks a `PodLauncher`. The fake never starts
 * containers itself and holds no Docker socket (decision 2 of the e2e plan): the e2e runtime's
 * orchestrator, on the host, implements the launcher with `docker run`, from an allowlist of
 * images, and the fake reaches it over HTTP with `httpLauncher`.
 */

/** What a created pod runs, as the fake hands it to the launcher. */
export interface LaunchSpec {
  /** The pod's ID, as Runpod gave it: the orchestrator names and labels the container by it. */
  id: string;
  name: string;
  image: string;
  /** The pod's environment, exactly as the create request sent it. */
  env: Record<string, string>;
  /** The exposed ports, from the request's `port/protocol` list. */
  ports: { port: number; protocol: string }[];
  gpu: { id: string; count: number; memoryGb: number | undefined };
  cloud: "SECURE" | "COMMUNITY";
  diskGb: number | undefined;
  /** The CUDA version of the host the fake placed it on; null when the GPU type lists none. */
  cudaVersion: string | null;
}

/** A launched pod: where each of its exposed ports is reached, for the fake's proxy. */
export interface LaunchedPod {
  /** An http(s) URL without a trailing slash, such as `http://172.18.0.7:8000`; undefined when the port serves nothing. */
  urlForPort(port: number): string | undefined;
}

/** Why the container could not start: the pod turns `ERROR`. */
export interface LaunchFailure {
  failure: string;
}

export type LaunchResult = LaunchedPod | LaunchFailure;

export interface PodLauncher {
  /**
   * Starts the pod's container, and resolves once it runs: the pod is `STARTING` until then, and
   * `RUNNING` after. A promise that never settles is a pod that never starts. Rejecting is a
   * failure, as `{ failure }` is.
   */
  launch(pod: LaunchSpec): Promise<LaunchResult>;
  /** Stops and removes the container; one already gone is not an error. */
  terminate(id: string): Promise<void>;
}

export function isFailure(result: LaunchResult): result is LaunchFailure {
  return typeof (result as LaunchFailure).failure === "string";
}

/** The launcher when none is configured: pods run, and serve nothing (the proxy answers 404). */
export const noContainers: PodLauncher = {
  launch: async () => ({ urlForPort: () => undefined }),
  terminate: async () => {},
};

/**
 * A launcher behind an HTTP API, as the orchestrator serves it:
 *
 * - `POST {base}/pods` with the `LaunchSpec` as JSON answers, once the container runs,
 *   `200 {"ports": {"8000": "http://host:port"}}`, or an error status with `{"failure": "..."}`;
 * - `DELETE {base}/pods/{id}` answers `204`, or `404` for a pod it does not know.
 *
 * `token`, when given, goes as `Authorization: Bearer <token>`.
 */
export function httpLauncher(
  base: string,
  options: { token?: string; fetch?: typeof fetch } = {},
): PodLauncher {
  const fetchFn = options.fetch ?? fetch;
  const headers: Record<string, string> = options.token
    ? { authorization: `Bearer ${options.token}` }
    : {};
  return {
    async launch(pod) {
      const response = await fetchFn(`${base}/pods`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(pod),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ports?: Record<string, unknown>;
        failure?: unknown;
        message?: unknown;
      };
      if (!response.ok) {
        const why = typeof body.failure === "string" ? body.failure : body.message;
        return { failure: `The launcher answered ${response.status}: ${String(why ?? "")}`.trim() };
      }
      const urls = new Map<number, string>();
      for (const [port, url] of Object.entries(body.ports ?? {})) {
        if (typeof url === "string") urls.set(Number(port), url.replace(/\/+$/, ""));
      }
      return { urlForPort: (port) => urls.get(port) };
    },
    async terminate(id) {
      const response = await fetchFn(`${base}/pods/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) {
        throw new Error(`The launcher did not terminate pod ${id}: ${response.status}.`);
      }
    },
  };
}
