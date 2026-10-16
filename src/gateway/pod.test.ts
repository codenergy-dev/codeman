import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  expiry,
  FitFailure,
  fitOptions,
  type OllamaServer,
  ollamaServeEnvironment,
  type PodPolicy,
  parseFitHint,
  podSettings,
  prepareOllama,
} from "./pod.ts";

const policy: PodPolicy = { startBy: 1_000_000, keptIdleMs: 900_000, runIdleMs: 1_800_000 };

test("a pod that never served terminates at its start limit", () => {
  const state = { ready: false, serving: false, lastActivity: 0 };
  assert.equal(expiry(state, policy, 999_999), undefined);
  assert.match(expiry(state, policy, 1_000_000) ?? "", /not served in time/);
});

test("a pod never terminates while it serves a run: the gateway stops spent and silent runs", () => {
  const serving = { ready: true, serving: true, lastActivity: 0 };
  assert.equal(expiry(serving, policy, 99_000_000), undefined);
});

test("a pod whose runs were stopped waits for their closes, then terminates", () => {
  // The last run stopped at 4,000,000: the pod waits its kept-idle time from then.
  const stopped = { ready: true, serving: false, lastActivity: 4_000_000, awaitingClose: true };
  assert.equal(expiry(stopped, policy, 4_899_999), undefined);
  assert.match(expiry(stopped, policy, 4_900_000) ?? "", /no key job ended them/);
});

test("a kept pod waits for its task's next run up to its idle limit", () => {
  const kept = { ready: true, serving: false, lastActivity: 2_000_000 };
  assert.equal(expiry(kept, policy, 2_899_999), undefined);
  assert.match(expiry(kept, policy, 2_900_000) ?? "", /no run came/);
});

test("reads the pod's settings from its environment", () => {
  const settings = podSettings({
    CODEMAN_MODEL: "qwen3-coder:30b",
    CODEMAN_ADMIN_SHA256: "a".repeat(64),
    CODEMAN_START_BY: "2026-10-03T12:25:00Z",
    CODEMAN_KEPT_IDLE_MINUTES: "15",
    RUNPOD_POD_ID: "abc",
    RUNPOD_API_KEY: "pod-key",
  });
  assert.equal(settings.policy.startBy, Date.parse("2026-10-03T12:25:00Z"));
  assert.equal(settings.policy.keptIdleMs, 900_000);
  assert.equal(settings.policy.runIdleMs, 1_800_000);
  assert.equal(settings.podId, "abc");
  assert.deepEqual(settings.ollama, { ok: true, value: {} }, "no Ollama settings");
  assert.throws(() => podSettings({ CODEMAN_MODEL: "m" }), /required/);
});

test("reads the pod's Ollama settings, and never lets one replace the gateway's own", () => {
  const env = {
    CODEMAN_MODEL: "qwen3-coder:30b",
    CODEMAN_ADMIN_SHA256: "a".repeat(64),
    CODEMAN_START_BY: "2026-10-03T12:25:00Z",
  };
  const settings = podSettings({
    ...env,
    CODEMAN_OLLAMA: '{"OLLAMA_CONTEXT_LENGTH":"65536","OLLAMA_NUM_PARALLEL":"4"}',
  });
  assert.deepEqual(settings.ollama, {
    ok: true,
    value: { OLLAMA_CONTEXT_LENGTH: "65536", OLLAMA_NUM_PARALLEL: "4" },
  });
  assert.deepEqual(podSettings({ ...env, CODEMAN_OLLAMA: '{"OLLAMA_KEEP_ALIVE":"5m"}' }).ollama, {
    ok: false,
    error: "CODEMAN_OLLAMA sets `OLLAMA_KEEP_ALIVE`, which Codeman does not.",
  });
  const serve = ollamaServeEnvironment(
    { PATH: "/bin", OLLAMA_HOST: "0.0.0.0:11434" },
    { OLLAMA_NUM_PARALLEL: "4", OLLAMA_KEEP_ALIVE: "5m", OLLAMA_CONTEXT_LENGTH: "65536" },
    undefined,
  );
  assert.deepEqual(serve, {
    PATH: "/bin",
    OLLAMA_HOST: "127.0.0.1:11434",
    OLLAMA_KEEP_ALIVE: "-1",
    OLLAMA_NUM_PARALLEL: "4",
    OLLAMA_CONTEXT_LENGTH: "65536",
  });
  assert.equal(
    ollamaServeEnvironment({}, {}, 262144).OLLAMA_CONTEXT_LENGTH,
    "262144",
    "the model's own, when restarted with it",
  );
});

/** A model as the fake Ollama shows it: 48 layers, 4 K/V heads of 128, 96 KiB a token in f16. */
const MODEL = "qwen3-coder:30b";
const DIGEST = "d1".repeat(32);
const SHOW = {
  details: { family: "qwen3moe" },
  model_info: {
    "general.architecture": "qwen3moe",
    "qwen3moe.context_length": 262144,
    "qwen3moe.block_count": 48,
    "qwen3moe.attention.head_count": 32,
    "qwen3moe.attention.head_count_kv": 4,
    "qwen3moe.attention.key_length": 128,
    "qwen3moe.attention.value_length": 128,
  },
};
const SIZE = 18_000_000_000;

/**
 * Ollama for the gateway's start: it pulls, shows the model, lists it, and loads it with the
 * context it was restarted with, wholly on the GPU only when `fits` says so. `calls` lists the
 * routes it answered, and `restarts` each context the gateway restarted it with.
 */
async function fakeOllama(options: {
  fits: (context: number) => boolean;
  show?: unknown;
  configured?: number;
}) {
  const calls: string[] = [];
  const restarts: (number | undefined)[] = [];
  let context = options.configured;
  let loaded = false;
  const server: Server = createServer(async (request, response) => {
    for await (const _ of request) {
      // Drain the body.
    }
    calls.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/api/pull") return response.end('{"status":"success"}\n');
    if (request.url === "/api/show") return response.end(JSON.stringify(options.show ?? SHOW));
    if (request.url === "/api/tags") {
      return response.end(
        JSON.stringify({ models: [{ name: MODEL, digest: DIGEST, size: SIZE }] }),
      );
    }
    if (request.url === "/api/generate") {
      loaded = true;
      return response.end("{}");
    }
    if (request.url === "/api/ps") {
      const size = SIZE + (context ?? 0) * 400_000;
      const fits = context !== undefined && options.fits(context);
      const models = loaded
        ? [
            {
              name: MODEL,
              model: MODEL,
              digest: DIGEST,
              size,
              size_vram: fits ? size : size - 3_200_000_000,
              context_length: context,
            },
          ]
        : [];
      return response.end(JSON.stringify({ models }));
    }
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ollama: OllamaServer = {
    url,
    restart: async (length) => {
      restarts.push(length);
      context = length;
      loaded = false;
    },
  };
  return { ollama, calls, restarts, close: () => server.close() };
}

test("with a context in the pod's settings, it loads once and checks the GPU", async () => {
  const fake = await fakeOllama({ fits: (context) => context <= 65536, configured: 65536 });
  const logs: string[] = [];
  const fit = await prepareOllama(fake.ollama, MODEL, (message) => logs.push(message), {
    configured: 65536,
    parallel: 4,
  });
  fake.close();
  assert.deepEqual(fake.restarts, [], "Ollama started with it");
  assert.deepEqual(fake.calls, [
    "GET /api/version",
    "POST /api/pull",
    "POST /api/show",
    "GET /api/tags",
    "POST /api/generate",
    "GET /api/ps",
  ]);
  assert.deepEqual(fit, {
    contextLength: 65536,
    modelContextLength: 262144,
    requestedParallel: 4,
    parallel: 4,
    source: "settings",
    loads: 1,
    digest: DIGEST,
    size: SIZE + 65536 * 400_000,
    sizeVram: SIZE + 65536 * 400_000,
    family: "qwen3moe",
  });
  assert.ok(
    logs.includes(`Serving ${MODEL} with a context length of 65536, from the pod's settings.`),
  );
});

test("a context in the settings that puts part of the model off the GPU stops the start", async () => {
  const fake = await fakeOllama({ fits: () => false, configured: 262144 });
  await assert.rejects(
    prepareOllama(fake.ollama, MODEL, () => undefined, { configured: 262144, parallel: 4 }),
    (error: Error) => {
      assert.ok(error instanceof FitFailure);
      assert.equal(
        error.message,
        "`qwen3-coder:30b` does not fit the GPU with 4 parallel requests and a context of 262144 tokens: Ollama put 3.2 of its 122.9 GB off the GPU, which runs much slower. Lower `context-length` or `num-parallel` in the `ollama` settings, set `kv-cache-type: q8_0`, or use a GPU with more memory.",
      );
      return true;
    },
  );
  fake.close();
  assert.deepEqual(fake.restarts, []);
});

test("without a context, the estimate is kept when the model fits with it", async () => {
  // 96 GB less the weights and the margin hold 213,636 tokens of 4 requests' cache: 52 × 4096.
  const fake = await fakeOllama({ fits: (context) => context <= 213_000 });
  const fit = await prepareOllama(fake.ollama, MODEL, () => undefined, {
    parallel: 4,
    gpuMemoryGb: 96,
  });
  fake.close();
  assert.deepEqual(fake.restarts, [212992]);
  assert.equal(fit.contextLength, 212992);
  assert.equal(fit.source, "search");
  assert.equal(fit.loads, 1);
});

test("without an estimate, it searches down from the model's own for the largest that fits", async () => {
  const fake = await fakeOllama({ fits: (context) => context <= 100_000 });
  const logs: string[] = [];
  const fit = await prepareOllama(fake.ollama, MODEL, (message) => logs.push(message), {
    parallel: 4,
  });
  fake.close();
  assert.equal(fit.contextLength, 98304, "24 × 4096");
  assert.equal(fake.restarts[0], 262144, "the model's own first");
  assert.equal(fake.restarts.at(-1), 98304, "served last");
  assert.ok(fake.restarts.every((context) => context === 98304 || (context ?? 0) >= 64000));
  assert.ok(fit.loads <= 9, `${fit.loads} loads`);
  assert.equal(fit.loads, fake.restarts.length);
  assert.ok(logs.includes(`Serving ${MODEL} with a context length of 98304.`));
  assert.ok(
    logs.some((line) => line.endsWith("a context of 262144 tokens: 3.2 GB off the GPU.")),
    "each load says where the model went",
  );
});

test("when even the floor does not fit, the start fails saying what to change", async () => {
  const fake = await fakeOllama({ fits: () => false });
  await assert.rejects(
    prepareOllama(fake.ollama, MODEL, () => undefined, { parallel: 10, gpuMemoryGb: 48 }),
    (error: Error) => {
      assert.ok(error instanceof FitFailure);
      assert.equal(
        error.message,
        "`qwen3-coder:30b` does not fit the GPU with 10 parallel requests and a context of 64000 tokens, the least Codeman gives an agent: Ollama put 3.2 of its 43.6 GB off the GPU, which runs much slower. Give the profile fewer tasks (`tasks` or `max-tasks`) or set a smaller `num-parallel`, set `kv-cache-type: q8_0` in the `ollama` settings, or use a GPU with more memory.",
      );
      return true;
    },
  );
  fake.close();
  assert.deepEqual(fake.restarts, [64000], "the estimate is below the floor: one load");
});

test("a cached context is tried first when its model's digest matches", async () => {
  const cached = await fakeOllama({ fits: (context) => context <= 150_000 });
  const fit = await prepareOllama(cached.ollama, MODEL, () => undefined, {
    parallel: 4,
    gpuMemoryGb: 96,
    hint: { contextLength: 147456, digest: DIGEST },
  });
  cached.close();
  assert.deepEqual(cached.restarts, [147456]);
  assert.equal(fit.source, "cache");

  // Another digest: the model changed under its name, so the estimate comes first.
  const other = await fakeOllama({ fits: (context) => context <= 213_000 });
  const fresh = await prepareOllama(other.ollama, MODEL, () => undefined, {
    parallel: 4,
    gpuMemoryGb: 96,
    hint: { contextLength: 147456, digest: "other" },
  });
  other.close();
  assert.deepEqual(other.restarts, [212992]);
  assert.equal(fresh.source, "search");

  // A cached context that no longer fits is searched below.
  const smaller = await fakeOllama({ fits: (context) => context <= 100_000 });
  const searched = await prepareOllama(smaller.ollama, MODEL, () => undefined, {
    parallel: 4,
    hint: { contextLength: 147456, digest: DIGEST },
  });
  smaller.close();
  assert.equal(smaller.restarts[0], 147456);
  assert.equal(searched.contextLength, 98304);
  assert.equal(searched.source, "search");
});

test("a family Ollama serves one request at a time is fitted for one, with a warning", async () => {
  const show = { ...SHOW, details: { family: "qwen35" } };
  const fake = await fakeOllama({ fits: () => true, show });
  const logs: string[] = [];
  const fit = await prepareOllama(fake.ollama, MODEL, (message) => logs.push(message), {
    parallel: 4,
    gpuMemoryGb: 96,
  });
  fake.close();
  assert.equal(fit.parallel, 1);
  assert.equal(fit.requestedParallel, 4);
  assert.equal(fit.contextLength, 262144, "one request's cache fits the model's own");
  assert.ok(logs.some((line) => line.includes("serves the qwen35 family one request at a time")));
});

test("a pull that reports an error stops the pod's start", async () => {
  const server: Server = createServer((request, response) => {
    response.writeHead(200);
    response.end(
      request.url === "/api/pull" ? '{"error":"pull model manifest: file does not exist"}\n' : "{}",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await assert.rejects(
    prepareOllama({ url, restart: async () => undefined }, "nope", () => undefined),
    /could not pull nope: pull model manifest/,
  );
  server.close();
});

test("reads a cached fit and the GPU's memory from the pod's environment, ignoring bad ones", () => {
  const env = {
    CODEMAN_MODEL: "qwen3-coder:30b",
    CODEMAN_ADMIN_SHA256: "a".repeat(64),
    CODEMAN_START_BY: "2026-10-03T12:25:00Z",
  };
  const settings = podSettings({
    ...env,
    CODEMAN_FIT: '{"contextLength":131072,"digest":"abc"}',
    CODEMAN_GPU_MEMORY_GB: "96",
  });
  assert.deepEqual(settings.fitHint, { contextLength: 131072, digest: "abc" });
  assert.equal(settings.gpuMemoryGb, 96);
  assert.equal(podSettings(env).fitHint, undefined);
  for (const bad of ["{", '{"contextLength":0,"digest":"abc"}', '{"contextLength":131072}']) {
    assert.equal(parseFitHint(bad), undefined, bad);
  }
  assert.equal(podSettings({ ...env, CODEMAN_GPU_MEMORY_GB: "x" }).gpuMemoryGb, undefined);
  assert.deepEqual(
    fitOptions(
      { OLLAMA_NUM_PARALLEL: "4", OLLAMA_KV_CACHE_TYPE: "q8_0", OLLAMA_GPU_OVERHEAD: "1000" },
      settings,
    ),
    {
      configured: undefined,
      parallel: 4,
      kvCacheType: "q8_0",
      gpuOverhead: 1000,
      gpuMemoryGb: 96,
      hint: { contextLength: 131072, digest: "abc" },
    },
  );
  assert.equal(fitOptions({}, settings).parallel, 1, "Ollama's default");
  assert.equal(fitOptions({ OLLAMA_CONTEXT_LENGTH: "65536" }, settings).configured, 65536);
});
