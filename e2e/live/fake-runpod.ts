import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_ROOT } from "../../src/action.ts";
import { NODE_RELEASE } from "../../src/inference/images.ts";

/**
 * Everything the pod check reaches, in memory, for its unit tests: Runpod's API and proxy with a
 * gateway on each pod, OSV.dev, Hugging Face's Hub and raw.githubusercontent.com. No network.
 */

export interface FakePod {
  id: string;
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
  /** Runpod creates the pod, but its answer is lost: the request fails. */
  loseCreateAnswer?: boolean;
  /** Called once a pod is created, before Runpod answers. */
  onCreate?: (pod: FakePod) => void;
  /** An advisory OSV.dev gives Ollama's release, high. */
  ollamaAdvisory?: string;
  /** The GPU's price per hour. */
  hourly?: number;
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
      const hourly = this.options.hourly ?? 0.27;
      return json(200, {
        id: decodeURIComponent(path.slice("/catalog/gpus/".length)),
        memory: 24,
        secure: true,
        community: true,
        price: { secure: hourly, community: hourly },
        availability: "HIGH",
        cudaVersions: [{ version: "13.0", available: true }],
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
      };
      const pod: FakePod = {
        id: this.#podId(),
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
      pod.status = "TERMINATED";
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && path === "/billing/pods") return json(200, { records: [] });
    this.unexpected.push(`${method} runpod ${path}`);
    return json(404, {});
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
    gpu: { id: "NVIDIA RTX A5000", count: 1 },
    cost: 0.27,
    createdAt: pod.createdAt,
    cudaVersion: "13.0",
    cloud: "SECURE",
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
