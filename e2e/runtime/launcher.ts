import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LaunchSpec } from "../fakes/runpod/launcher.ts";
import { docker, dockerOk, envArgs, removeLabeled } from "./docker.ts";
import type { TeeWorld } from "./scenario/schema.ts";

/**
 * The host side of the fake Runpod's pods (decision 2 of the e2e plan): a small HTTP API, behind
 * a token, that the fake reaches with `httpLauncher` (e2e/fakes/runpod/launcher.ts). It runs a
 * container only for an image the allowlist maps Codeman's pinned pod images to
 * (e2e/infra/pod-images.ts), on the internal jobs network, labeled so a scenario's end removes it.
 *
 * - `POST /pods` with a `LaunchSpec` answers `{ ports: { "<port>": "http://<container>:<port>" } }`
 *   once the container runs, or `{ failure }` with 403 for an image off the allowlist;
 * - `DELETE /pods/{id}` answers 204, or 404 for a pod it never started.
 */

/** How a pod's container runs: which `docker run` arguments, apart from its env. */
export interface PodPlan {
  /** The local image to run. */
  image: string;
  /** Volumes, as `docker run --volume` takes them. */
  volumes: string[];
  /** Variables the e2e image needs beyond the pod's own, such as the tee's. */
  env: Record<string, string>;
  /** The container's shared memory, as `docker run --shm-size` takes it, such as `1g`. */
  shm?: string;
}

/** Runs a pod's container; returns its name. The default runs `docker run`. */
export type PodRunner = (
  spec: LaunchSpec,
  plan: PodPlan,
  labels: Record<string, string>,
) => Promise<string>;
export type PodStopper = (id: string) => Promise<void>;

export interface LauncherOptions {
  /** The bearer token the fake sends. */
  token: string;
  /** The local plan for a pod's image; throws for an image off the allowlist. */
  plan(spec: LaunchSpec): PodPlan | Promise<PodPlan>;
  /** Labels for each pod's container, such as the scenario's. */
  labels(): Record<string, string>;
  run?: PodRunner;
  stop?: PodStopper;
  /**
   * Called before a pod's container is removed, while it may still run, such as to keep its
   * engine's last state for later checks. Its failure does not stop the removal.
   */
  stopping?(id: string): Promise<void>;
  /** Each launch and its outcome, for the timeline. */
  events?(event: { kind: "launch" | "refuse" | "terminate"; id: string; detail: string }): void;
}

export const POD_LABEL = "codeman-e2e.pod";

export class Launcher {
  readonly #options: LauncherOptions;
  readonly #pods = new Map<string, string>();
  #server: Server | undefined;

  constructor(options: LauncherOptions) {
    this.#options = options;
  }

  /** The pods it started, by ID, with their container's name. */
  get pods(): ReadonlyMap<string, string> {
    return this.#pods;
  }

  async listen(port = 0, host = "127.0.0.1"): Promise<number> {
    const server = createServer((request, response) => {
      this.#handle(request, response).catch((error: unknown) => {
        if (!response.headersSent)
          reply(response, 500, { failure: String((error as Error).message ?? error) });
        else response.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    this.#server = server;
    return (server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** Forgets the pods of a scenario whose containers were removed by label. */
  forget(): void {
    this.#pods.clear();
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!authorized(request.headers.authorization, this.#options.token)) {
      return reply(response, 401, { failure: "The launcher needs its token." });
    }
    const url = new URL(request.url ?? "/", "http://launcher");
    const body = await read(request);
    if (request.method === "POST" && url.pathname === "/pods") {
      let spec: LaunchSpec;
      try {
        spec = JSON.parse(body.toString("utf8")) as LaunchSpec;
      } catch {
        return reply(response, 400, { failure: "The body is not JSON." });
      }
      if (
        typeof spec?.id !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(spec.id) ||
        typeof spec.image !== "string"
      ) {
        return reply(response, 400, { failure: "A launch has a pod ID and an image." });
      }
      let plan: PodPlan;
      try {
        plan = await this.#options.plan(spec);
      } catch (error) {
        const failure = (error as Error).message;
        this.#options.events?.({ kind: "refuse", id: spec.id, detail: failure });
        return reply(response, 403, { failure });
      }
      const run = this.#options.run ?? runPod;
      let name: string;
      try {
        name = await run(spec, plan, { ...this.#options.labels(), [POD_LABEL]: spec.id });
      } catch (error) {
        const failure = (error as Error).message;
        this.#options.events?.({ kind: "launch", id: spec.id, detail: `failed: ${failure}` });
        return reply(response, 500, { failure });
      }
      this.#pods.set(spec.id, name);
      this.#options.events?.({ kind: "launch", id: spec.id, detail: `${plan.image} as ${name}` });
      const ports: Record<string, string> = {};
      for (const { port } of spec.ports ?? []) ports[String(port)] = `http://${name}:${port}`;
      return reply(response, 200, { ports });
    }
    const match = /^\/pods\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === "DELETE" && match?.[1]) {
      const id = match[1];
      if (!this.#pods.has(id)) return reply(response, 404, { failure: `No pod ${id}.` });
      await this.#options.stopping?.(id).catch(() => undefined);
      await (this.#options.stop ?? stopPod)(id);
      this.#pods.delete(id);
      this.#options.events?.({ kind: "terminate", id, detail: "removed" });
      return reply(response, 204);
    }
    return reply(response, 404, { failure: "Not found." });
  }
}

/** The pod's container: `docker run --init` on the jobs network, with the pod's env. */
export function podRunner(network: string): PodRunner {
  return async (spec, plan, labels) => {
    const name = `codeman-e2e-pod-${spec.id}`.toLowerCase();
    const passed = envArgs({ ...spec.env, ...plan.env });
    await docker(["rm", "-f", name]);
    await dockerOk(
      [
        "run",
        "--detach",
        "--init",
        "--name",
        name,
        ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
        "--network",
        network,
        ...plan.volumes.flatMap((volume) => ["--volume", volume]),
        ...(plan.shm ? ["--shm-size", plan.shm] : []),
        ...passed.args,
        plan.image,
      ],
      { env: passed.env },
    );
    return name;
  };
}

const runPod: PodRunner = podRunner("codeman-e2e-jobs");

async function stopPod(id: string): Promise<void> {
  await removeLabeled(`${POD_LABEL}=${id}`);
}

/**
 * The plan for a pod's image, from the allowlist of e2e/infra/pod-images.ts: the local image,
 * its model volume, read-only, the tee's way to the scripted model, and the scenario's tee options
 * (`teeEnv`). Fails, saying so, while
 * the allowlist's file is missing.
 *
 * A vLLM pod gets 1 GiB of shared memory, as spike 0.1 of the e2e plan ran vLLM: its CPU engine
 * allocates 160 MiB there at its start, and Docker's default of 64 MiB fails it ("Insufficient
 * space in /dev/shm"). A Runpod pod's /dev/shm is not Docker's default.
 */
export async function allowlistPlan(
  spec: LaunchSpec,
  tee: { model: string; controlToken: string; env?: Record<string, string> },
): Promise<PodPlan> {
  let localPodImage: (image: string) => string;
  try {
    ({ localPodImage } = await import("../infra/pod-images.ts"));
  } catch (error) {
    throw new Error(
      `No allowlist of pod images: e2e/infra/pod-images.ts could not be loaded (${(error as Error).message}).`,
    );
  }
  const image = localPodImage(spec.image);
  const volumes = ["codeman-e2e-ca:/etc/codeman-e2e:ro"];
  if (/ollama/.test(image)) volumes.push("codeman-e2e-ollama:/root/.ollama/models:ro");
  if (/vllm/.test(image)) volumes.push("codeman-e2e-hf:/root/.cache/huggingface:ro");
  return {
    image,
    volumes,
    env: { ...tee.env, TEE_MODEL: tee.model, FAKE_CONTROL_TOKEN: tee.controlToken },
    ...(/vllm/.test(image) ? { shm: "1g" } : {}),
  };
}

function authorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function read(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 1 << 20) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reply(response: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/** The tee's variables for a scenario's `world.runpod.tee` (e2e/fakes/llm/tee.ts, `fromEnv`). */
export function teeEnv(tee: TeeWorld | undefined): Record<string, string> {
  if (!tee?.meet) return {};
  return {
    TEE_MEET_ISSUES: String(tee.meet.issues),
    TEE_MEET_TIMEOUT_MS: String(tee.meet.timeoutMs),
  };
}
