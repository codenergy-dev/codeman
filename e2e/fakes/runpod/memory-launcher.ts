import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LaunchResult, LaunchSpec, PodLauncher } from "./launcher.ts";

/**
 * A launcher for the fake's tests, without Docker: each pod is an HTTP server on the loopback
 * that answers `/health` as ready, `/env` with the environment it was launched with, and echoes
 * any other request's method, path and body. `hold` keeps launches pending until `release`.
 */
export class MemoryLauncher implements PodLauncher {
  readonly launched: LaunchSpec[] = [];
  readonly terminated: string[] = [];
  /** While true, launches wait for `release`. */
  hold = false;
  /** Launches fail with this reason, when set. */
  failure: string | undefined;
  readonly #servers = new Map<string, Server>();
  readonly #pending: (() => void)[] = [];

  async launch(pod: LaunchSpec): Promise<LaunchResult> {
    this.launched.push(pod);
    if (this.hold) await new Promise<void>((resolve) => this.#pending.push(resolve));
    if (this.failure) return { failure: this.failure };
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body =
          request.url === "/health"
            ? { ready: true }
            : request.url === "/env"
              ? pod.env
              : {
                  method: request.method,
                  url: request.url,
                  body: Buffer.concat(chunks).toString("utf8"),
                };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.#servers.set(pod.id, server);
    const { port } = server.address() as AddressInfo;
    const exposed = new Set(pod.ports.map((one) => one.port));
    return {
      urlForPort: (asked) => (exposed.has(asked) ? `http://127.0.0.1:${port}` : undefined),
    };
  }

  async terminate(id: string): Promise<void> {
    this.terminated.push(id);
    const server = this.#servers.get(id);
    this.#servers.delete(id);
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /** Lets the held launches go on. */
  release(): void {
    for (const resolve of this.#pending.splice(0)) resolve();
  }

  async close(): Promise<void> {
    this.release();
    await Promise.all([...this.#servers.keys()].map((id) => this.terminate(id)));
  }
}
