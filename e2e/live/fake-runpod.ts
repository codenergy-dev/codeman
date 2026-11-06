import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_ROOT } from "../../src/action.ts";
import { NODE_RELEASE } from "../../src/inference/images.ts";
import { type Cloud, GPU_TYPES } from "./check.ts";

/**
 * Everything the pod check reaches, in memory, for its unit tests: Runpod's API and proxy with a
 * gateway on each pod, OSV.dev, Hugging Face's Hub and raw.githubusercontent.com. No network.
 */

/** A GPU type on each cloud: its price per hour and availability; null where not offered. */
export interface FakeGpu {
  memory?: number;
  secure?: { price: number; availability: string } | null;
  community?: { price: number; availability: string } | null;
}

export interface FakePod {
  id: string;
  gpu: string;
  cloud: Cloud;
  hourly: number;
  image: string;
  command: string[];
  env: Record<string, string>;
  status: "RUNNING" | "TERMINATED";
  createdAt: string;
}

export interface FakeOptions {
  /** The chat completion's status. */
  chatStatus?: number;
  /** The gateway's start failure, such as the fit's message; it then never serves. */
  startFailure?: string;
  /** Runpod says every pod failed once created. */
  podsFail?: boolean;
  /** Runpod refuses every termination with 500. */
  terminateFails?: boolean;
  /** Runpod creates the pod, but its answer is lost: the request fails. */
  loseCreateAnswer?: boolean;
  /** Called once a pod is created, before Runpod answers. */
  onCreate?: (pod: FakePod) => void;
  /** An advisory OSV.dev gives Ollama's release, high. */
  ollamaAdvisory?: string;
  /**
   * The catalog, by GPU ID; a GPU type it does not name answers 404. By default, every one of
   * `GPU_TYPES`, on both clouds, at `hourly` and `availability`.
   */
  catalog?: Readonly<Record<string, FakeGpu>>;
  /** The default catalog's price per hour, 0.27 USD. */
  hourly?: number;
  /** The default catalog's availability, `HIGH`. */
  availability?: string;
  /** Runpod refuses a creation with this status and problem `detail`, made from the request. */
  createError?: (spec: {
    env: Record<string, string>;
    gpu: string;
    cloud: Cloud;
  }) => { status: number; detail: string } | undefined;
  /** What the gateway reports it runs on: `NODE_RELEASE`'s version, and the file served. */
  node?: string;
  gatewaySha256?: string;
}

const GATEWAY = readFileSync(join(ACTION_ROOT, "dist/gateway.js"));
const GATEWAY_SHA256 = createHash("sha256").update(GATEWAY).digest("hex");

export class FakeRunpod {
  readonly pods = new Map<string, FakePod>();
  /** Every bearer token a request carried, with the lines printed before it. */
  readonly bearers: { token: string; printed: readonly string[] }[] = [];
  /** Requests the fake did not expect. */
  readonly unexpected: string[] = [];
  /** Each catalog read, as `<GPU ID> <cloud>`. */
  readonly catalogReads: string[] = [];
  readonly options: FakeOptions;
  readonly #lines: readonly string[];
  #next = 1;

  /** `lines`: what the check has printed so far, read at each request. */
  constructor(lines: readonly string[], options: FakeOptions = {}) {
    this.#lines = lines;
    this.options = options;
  }

  /** A pod that is not the check's, which nothing may terminate. */
  addPod(env: Record<string, string>): FakePod {
    const pod: FakePod = {
      id: this.#podId(),
      gpu: "NVIDIA RTX A5000",
      cloud: "secure",
      hourly: 0.27,
      image: "docker.io/ollama/ollama@sha256:0",
      command: [],
      env,
      status: "RUNNING",
      createdAt: new Date().toISOString(),
    };
    this.pods.set(pod.id, pod);
    return pod;
  }

  /** Long and distinctive, so a test finds any line that prints one. */
  #podId(): string {
    return `zq${String(this.#next++).padStart(3, "0")}podidx9k`;
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const auth = new Headers(init?.headers).get("authorization");
    if (auth?.startsWith("Bearer ")) {
      this.bearers.push({ token: auth.slice(7), printed: [...this.#lines] });
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.hostname === "api.runpod.io") return this.#runpod(method, url, body);
    const proxy = /^(.+)-8080\.proxy\.runpod\.net$/.exec(url.hostname);
    if (proxy) return this.#gateway(proxy[1] as string, method, url.pathname, auth);
    if (url.hostname === "api.osv.dev") return this.#osv(url.pathname, body);
    if (url.hostname === "huggingface.co") return this.#hub(url.pathname);
    if (url.hostname === "raw.githubusercontent.com") return new Response(GATEWAY);
    this.unexpected.push(`${method} ${url.hostname}`);
    return json(404, {});
  };

  #runpod(method: string, url: URL, body: Record<string, unknown> | undefined): Response {
    const path = url.pathname.replace(/^\/v2/, "");
    if (method === "GET" && path.startsWith("/catalog/gpus/")) {
      const id = decodeURIComponent(path.slice("/catalog/gpus/".length));
      const gpu = this.#gpu(id);
      if (!gpu) return json(404, { title: "Not Found", status: 404, detail: "No such GPU type." });
      const cloud = (url.searchParams.get("cloud") ?? "SECURE").toLowerCase() as Cloud;
      const offer = gpu[cloud];
      const level = offer?.availability ?? "NONE";
      this.catalogReads.push(`${id} ${cloud}`);
      return json(200, {
        id,
        memory: gpu.memory ?? 24,
        secure: gpu.secure !== null && gpu.secure !== undefined,
        community: gpu.community !== null && gpu.community !== undefined,
        price: { secure: gpu.secure?.price, community: gpu.community?.price },
        ...(url.searchParams.get("include") === "AVAILABILITY"
          ? {
              availability: level,
              dataCenters: [
                { id: "EU-RO-1", availability: level },
                { id: "US-TX-3", availability: "NONE" },
              ],
              cudaVersions: [{ version: "13.0", available: level !== "NONE" }],
            }
          : {}),
      });
    }
    if (method === "GET" && path === "/pods") {
      const live = [...this.pods.values()].filter((pod) => pod.status !== "TERMINATED");
      return json(200, {
        pods: live.map((pod) => runpodPod(pod)),
        pagination: { hasNextPage: false },
      });
    }
    if (method === "POST" && path === "/pods") {
      const spec = body as { image: string; entrypoint: string[]; cmd: string[] } & {
        env: Record<string, string>;
        gpu: { id: string };
        cloud: string;
      };
      const gpu = spec.gpu.id;
      const cloud = spec.cloud.toLowerCase() as Cloud;
      const refused = this.options.createError?.({ env: spec.env, gpu, cloud });
      if (refused) {
        return new Response(
          JSON.stringify({ title: "Bad Request", status: refused.status, detail: refused.detail }),
          { status: refused.status, headers: { "Content-Type": "application/problem+json" } },
        );
      }
      const pod: FakePod = {
        id: this.#podId(),
        gpu,
        cloud,
        hourly: this.#gpu(gpu)?.[cloud]?.price ?? 0,
        image: spec.image,
        command: [...spec.entrypoint, ...spec.cmd],
        env: spec.env,
        status: "RUNNING",
        createdAt: new Date().toISOString(),
      };
      this.pods.set(pod.id, pod);
      this.options.onCreate?.(pod);
      if (this.options.loseCreateAnswer) throw new TypeError("fetch failed");
      return json(200, runpodPod(pod, this.options.podsFail));
    }
    const pod = this.pods.get(decodeURIComponent(path.slice("/pods/".length)));
    if (path.startsWith("/pods/") && method === "GET") {
      if (!pod || pod.status === "TERMINATED") return json(404, {});
      return json(200, runpodPod(pod, this.options.podsFail));
    }
    if (path.startsWith("/pods/") && method === "DELETE") {
      if (!pod) return json(404, {});
      if (this.options.terminateFails) return json(500, { title: "Internal Server Error" });
      pod.status = "TERMINATED";
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && path === "/billing/pods") return json(200, { records: [] });
    this.unexpected.push(`${method} runpod ${path}`);
    return json(404, {});
  }

  /** A GPU type of the catalog. */
  #gpu(id: string): FakeGpu | undefined {
    if (this.options.catalog) return this.options.catalog[id];
    if (!GPU_TYPES.includes(id)) return undefined;
    const offer = {
      price: this.options.hourly ?? 0.27,
      availability: this.options.availability ?? "HIGH",
    };
    return { secure: offer, community: offer };
  }

  #gateway(id: string, method: string, path: string, auth: string | null): Response {
    const pod = this.pods.get(id);
    if (!pod || pod.status === "TERMINATED") return json(502, {});
    const failure = this.options.startFailure;
    if (path === "/health")
      return json(200, { ready: !failure, ...(failure ? { failed: true } : {}) });
    if (path.startsWith("/admin/")) {
      const token = auth?.slice(7) ?? "";
      if (sha256(token) !== pod.env.CODEMAN_ADMIN_SHA256) return json(401, {});
      if (path === "/admin/end") {
        return json(200, { cost: 0.0123, inputTokens: 20, outputTokens: 2, requests: 1 });
      }
      const engine = pod.env.CODEMAN_ENGINE;
      return json(200, {
        version: 2,
        engine,
        node: this.options.node ?? `v${NODE_RELEASE.release.version}`,
        gatewaySha256: this.options.gatewaySha256 ?? GATEWAY_SHA256,
        ready: !failure,
        failure,
        ollama: JSON.parse(pod.env.CODEMAN_OLLAMA ?? "{}"),
        vllm: pod.env.CODEMAN_VLLM ? JSON.parse(pod.env.CODEMAN_VLLM) : undefined,
        fit: failure
          ? undefined
          : engine === "vllm"
            ? {
                engine: "vllm",
                contextLength: 32768,
                modelContextLength: 32768,
                requestedParallel: 1,
                parallel: 1,
                concurrency: 52.4,
                cacheTokens: 1_717_000,
                source: "search",
                loads: 1,
                toolCallParser: "hermes",
              }
            : {
                contextLength: 32768,
                modelContextLength: 32768,
                requestedParallel: 1,
                parallel: 1,
                source: "search",
                loads: 1,
                digest: "a".repeat(64),
                size: 1_200_000_000,
                sizeVram: 1_200_000_000,
                family: "qwen2",
                vision: false,
              },
      });
    }
    if (method === "POST" && path === "/v1/chat/completions") {
      const status = this.options.chatStatus ?? 200;
      return status === 200
        ? json(200, {
            choices: [{ message: { role: "assistant", content: "ready" } }],
            usage: { prompt_tokens: 20, completion_tokens: 2 },
          })
        : json(status, { error: { message: `secret body of ${id}` } });
    }
    this.unexpected.push(`${method} gateway ${path}`);
    return json(404, {});
  }

  #osv(path: string, body: { queries?: { package: { name: string } }[] } | undefined): Response {
    const advisory = this.options.ollamaAdvisory;
    if (path === "/v1/querybatch") {
      return json(200, {
        results: (body?.queries ?? []).map((query) =>
          advisory && query.package.name === "github.com/ollama/ollama"
            ? { vulns: [{ id: advisory }] }
            : {},
        ),
      });
    }
    if (advisory && path === `/v1/vulns/${advisory}`) {
      return json(200, {
        id: advisory,
        summary: "A flaw",
        aliases: [],
        database_specific: { severity: "HIGH" },
        affected: [
          {
            package: { ecosystem: "Go", name: "github.com/ollama/ollama" },
            ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }] }],
          },
        ],
      });
    }
    return json(404, {});
  }

  #hub(path: string): Response {
    if (path.startsWith("/api/models/")) {
      return json(200, { siblings: [{ rfilename: "model.safetensors", size: 988_097_824 }] });
    }
    if (path.endsWith("/resolve/main/config.json")) return json(200, {});
    return json(404, {});
  }
}

function runpodPod(pod: FakePod, failed = false) {
  return {
    id: pod.id,
    name: "codeman-pod",
    status: failed && pod.status === "RUNNING" ? "ERROR" : pod.status,
    image: pod.image,
    env: pod.env,
    gpu: { id: pod.gpu, count: 1 },
    cost: pod.hourly,
    createdAt: pod.createdAt,
    cudaVersion: "13.0",
    cloud: pod.cloud.toUpperCase(),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
