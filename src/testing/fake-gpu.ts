import { createHash } from "node:crypto";
import { type InferenceEngine, openAiUsage } from "../inference/engine.ts";
import type {
  Endpoint,
  GpuProvider,
  Pod,
  PodHost,
  PodSpec,
  PodStatus,
  ServerlessHost,
} from "../inference/gpu.ts";

/** A GPU cloud for tests: pods and endpoints in memory, and the calls made to it. */
export class FakeGpu implements GpuProvider {
  readonly name = "fake";
  readonly pods: PodHost;
  readonly serverless: ServerlessHost;
  /** Pods by ID; terminated ones are removed, as the provider forgets them. */
  readonly live = new Map<string, Pod>();
  readonly created: PodSpec[] = [];
  readonly terminated: string[] = [];
  /** USD per second, by GPU type; types not listed are not offered. */
  readonly prices: Record<string, number>;
  /** What each pod was billed, by ID, terminated pods included. */
  readonly billed: Record<string, number> = {};
  readonly endpoints = new Map<string, Endpoint>();
  endpointPrice = 0.0003;
  month = 0;
  /** The status a pod has after `create`, and how many `get`s it takes to run. */
  startAfter = 0;
  now: () => Date;
  #next = 1;
  #gets = new Map<string, number>();

  constructor(options: { prices?: Record<string, number>; now?: () => Date } = {}) {
    this.prices = options.prices ?? { "GPU-A": 0.0002 };
    this.now = options.now ?? (() => new Date("2026-10-03T12:00:00Z"));
    this.pods = {
      price: async (gpuType) => {
        const price = this.prices[gpuType];
        if (price === undefined) throw new Error(`No ${gpuType} on Secure Cloud.`);
        return price;
      },
      create: async (spec) => {
        this.created.push(spec);
        const pod: Pod = {
          id: `pod${this.#next++}`,
          name: spec.name,
          status: "starting",
          image: spec.image,
          env: { ...spec.env },
          gpuType: spec.gpuType,
          createdAt: this.now(),
          pricePerSecond: this.prices[spec.gpuType],
        };
        this.live.set(pod.id, pod);
        return { ...pod };
      },
      get: async (id) => {
        const pod = this.live.get(id);
        if (!pod) return undefined;
        const gets = (this.#gets.get(id) ?? 0) + 1;
        this.#gets.set(id, gets);
        if (pod.status === "starting" && gets > this.startAfter) pod.status = "running";
        return { ...pod };
      },
      list: async (env) =>
        [...this.live.values()]
          .filter((pod) => Object.entries(env).every(([name, value]) => pod.env[name] === value))
          .map((pod) => ({ ...pod })),
      terminate: async (id) => {
        this.terminated.push(id);
        this.live.delete(id);
      },
      url: (id, port) => `https://${id}-${port}.pods.test`,
      billing: async (ids) => {
        const billed: Record<string, number> = {};
        for (const id of ids) {
          const amount = this.billed[id];
          if (amount !== undefined) billed[id] = amount;
        }
        return billed;
      },
    };
    this.serverless = {
      endpoint: async (id) => {
        const endpoint = this.endpoints.get(id);
        if (!endpoint) throw new Error(`No endpoint ${id}.`);
        return { ...endpoint };
      },
      price: async () => this.endpointPrice,
      queueUrl: (id) => `https://serverless.test/${id}`,
    };
  }

  async monthSpent(): Promise<number> {
    return this.month;
  }

  /** Sets a pod's status, as the provider would. */
  setStatus(id: string, status: PodStatus): void {
    const pod = this.live.get(id);
    if (pod) pod.status = status;
  }
}

/** An engine for tests: any model name without spaces, and OpenAI's usage. */
export const fakeEngine: InferenceEngine = {
  name: "fake",
  example: "model",
  isModel: (model) => /^\S+$/.test(model),
  usage: (body) => openAiUsage(body),
};

/** A pod's gateway, as the fake answers for it. */
export interface FakeGatewayState {
  ready: boolean;
  serving: boolean;
  lastActivity: number;
  contextLength?: number | undefined;
  /** Whether it answers at all. */
  reachable: boolean;
  /** The last run it was given, and the usage `/admin/end` reports. */
  run?: Record<string, unknown> | undefined;
  usage: Record<string, unknown>;
}

/**
 * The gateways of a FakeGpu's pods, answering `fetch` at their URLs: `/health` and the admin
 * routes, which take only the token whose hash the pod was created with.
 */
export class FakeGateways {
  readonly gpu: FakeGpu;
  readonly states = new Map<string, FakeGatewayState>();
  readonly calls: string[] = [];

  constructor(gpu: FakeGpu) {
    this.gpu = gpu;
  }

  state(id: string): FakeGatewayState {
    let state = this.states.get(id);
    if (!state) {
      state = {
        ready: true,
        serving: false,
        lastActivity: this.gpu.now().getTime(),
        contextLength: 65536,
        reachable: true,
        usage: { requests: 2, inputTokens: 3000, outputTokens: 120, maxInputTokens: 2000 },
      };
      this.states.set(id, state);
    }
    return state;
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const id = /^(\w+)-\d+\.pods\.test$/.exec(url.host)?.[1] ?? "";
    const pod = this.gpu.live.get(id);
    this.calls.push(`${init?.method ?? "GET"} ${id} ${url.pathname}`);
    const state = this.state(id);
    if (!pod || !state.reachable) throw new TypeError("fetch failed");
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname === "/health") return json(200, { ready: state.ready });
    const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    const hash = createHash("sha256").update(token).digest("hex");
    if (hash !== pod.env.CODEMAN_ADMIN_SHA256) return json(401, {});
    if (url.pathname === "/admin/status") {
      return json(200, {
        ready: state.ready,
        serving: state.serving,
        lastActivity: state.lastActivity,
        contextLength: state.contextLength,
      });
    }
    if (url.pathname === "/admin/run") {
      state.run = JSON.parse(String(init?.body)) as Record<string, unknown>;
      state.serving = true;
      return json(200, {});
    }
    if (url.pathname === "/admin/end") {
      state.serving = false;
      state.lastActivity = this.gpu.now().getTime();
      return json(200, state.usage);
    }
    return json(404, {});
  }) as typeof fetch;
}
