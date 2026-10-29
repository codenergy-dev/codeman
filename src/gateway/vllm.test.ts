import assert from "node:assert/strict";
import { test } from "node:test";
import { podSettings } from "./pod.ts";
import {
  autoFitModelContext,
  cacheCapacity,
  checkDriverCuda,
  driverCudaVersion,
  nextContext,
  prepareVllm,
  servedContext,
  VllmFitFailure,
  type VllmServer,
  vllmError,
  vllmServeArguments,
  vllmServeEnvironment,
} from "./vllm.ts";

const MODEL = "unsloth/Qwen3.8-27B-NVFP4";
const metrics = (tokens: number, concurrency: number) =>
  [
    "# HELP vllm:cache_config_info Information of the LLMEngine CacheConfig",
    "# TYPE vllm:cache_config_info gauge",
    `vllm:cache_config_info{block_size="16",cache_dtype="fp8",engine="0",gpu_memory_utilization="0.92",kv_cache_max_concurrency="${concurrency}",kv_cache_size_tokens="${tokens}",num_gpu_blocks="1000"} 1.0`,
    "vllm:num_requests_running 0.0",
  ].join("\n");

/**
 * A fake vLLM on a GPU whose K/V cache holds `available` tokens, each request taking its context
 * plus `fixed` tokens' worth of linear-attention state, for a model of `own` tokens. Like vLLM, it
 * refuses a context whose cache cannot hold one request, and auto-fits the largest that can.
 */
function fakeVllm(options: {
  available: number;
  fixed?: number;
  own?: number;
  toolCalls?: boolean;
}): VllmServer & { starts: (number | "auto")[]; probes: number } {
  const { available, fixed = 0, own = 262_144 } = options;
  let served: { context: number; concurrency: number } | undefined;
  let reason: string | undefined;
  let output: string[] = [];
  const server = {
    url: "http://127.0.0.1:8000",
    starts: [] as (number | "auto")[],
    probes: 0,
    start: async (context: number | "auto") => {
      server.starts.push(context);
      served = undefined;
      reason = undefined;
      output = ["INFO Starting vLLM."];
      const fits = (length: number) => available / (length + fixed) >= 1;
      let length: number;
      if (context === "auto") {
        length = Math.min(own, available - fixed);
        if (length <= 0) {
          reason =
            "ValueError: Cannot auto-fit max_model_len: not enough GPU memory available to serve even a single token";
          return;
        }
        output.push(
          length === own
            ? `INFO Auto-fit max_model_len: full model context length ${own} fits in available GPU memory`
            : `INFO Auto-fit max_model_len: reduced from ${own} to ${length} to fit in available GPU memory (9.5 GiB available for KV cache)`,
        );
      } else if (!fits(context)) {
        reason = `ValueError: To serve at least one request with the model's max seq len (${context}), (8.50 GiB KV cache is needed, which is larger than the available KV cache memory (4.0 GiB). Based on the available memory, the estimated maximum model length is ${available - fixed}.`;
        return;
      } else length = context;
      served = { context: length, concurrency: available / (length + fixed) };
    },
    stopped: () => reason,
    output: () => output,
    wait: async () => {},
    fetch: (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (!served) throw new Error("connection refused");
      if (path === "/health") return new Response("", { status: 200 });
      if (path === "/v1/models") {
        return Response.json({ data: [{ id: MODEL, max_model_len: served.context }] });
      }
      if (path === "/metrics") {
        return new Response(metrics(served.concurrency * served.context, served.concurrency));
      }
      if (path === "/v1/chat/completions") {
        server.probes++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.tools[0].function.name, "ping");
        assert.equal(body.tool_choice, "auto");
        const message =
          options.toolCalls === false
            ? { content: "<tool_call>ping</tool_call>", tool_calls: [] }
            : {
                tool_calls: [
                  { id: "1", type: "function", function: { name: "ping", arguments: "{}" } },
                ],
              };
        return Response.json({ choices: [{ message }] });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch,
  };
  return server;
}

const options = { maxNumSeqs: 4, toolCallParser: "qwen3_xml" };

test("vLLM serves on the loopback, under the run's model, with tool calls and the context given", () => {
  assert.deepEqual(
    vllmServeArguments(
      MODEL,
      { "max-model-len": "65536", "max-num-seqs": "4", "tool-call-parser": "qwen3_xml" },
      "auto",
    ),
    [
      "serve",
      MODEL,
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "--served-model-name",
      MODEL,
      "--enable-auto-tool-choice",
      "--max-num-seqs",
      "4",
      "--tool-call-parser",
      "qwen3_xml",
      "--max-model-len",
      "auto",
    ],
  );
  assert.throws(() => vllmServeArguments(MODEL, { host: "0.0.0.0" }, 4096), /cannot set `host`/);
  const env = vllmServeEnvironment({
    PATH: "/bin",
    RUNPOD_API_KEY: "secret",
    CUDA_VISIBLE_DEVICES: "MIG-1b2c3d4e-0000-1111-2222-333344445555",
  });
  assert.deepEqual(env, {
    PATH: "/bin",
    CUDA_VISIBLE_DEVICES: "0",
    VLLM_NO_USAGE_STATS: "1",
    DO_NOT_TRACK: "1",
  });
  assert.equal(vllmServeEnvironment({ CUDA_VISIBLE_DEVICES: "1" }).CUDA_VISIBLE_DEVICES, "1");
});

test("reads vLLM's served context, its cache's capacity, its auto-fit and its errors", () => {
  assert.deepEqual(cacheCapacity(metrics(1_700_000, 6.48)), {
    cacheTokens: 1_700_000,
    concurrency: 6.48,
  });
  assert.equal(cacheCapacity("vllm:num_requests_running 0.0"), undefined);
  assert.equal(cacheCapacity('vllm:cache_config_info{kv_cache_size_tokens="None"} 1.0'), undefined);
  assert.equal(servedContext({ data: [{ id: MODEL, max_model_len: 131072 }] }, MODEL), 131072);
  assert.equal(servedContext({ data: [] }, MODEL), undefined);
  assert.equal(
    autoFitModelContext([
      "INFO Auto-fit max_model_len: reduced from 262144 to 190000 to fit in available GPU memory",
    ]),
    262144,
  );
  assert.equal(autoFitModelContext(["INFO nothing"]), undefined);
  assert.equal(
    vllmError(
      [
        "(EngineCore_DP0 pid=80) ERROR Traceback (most recent call last):",
        "(EngineCore_DP0 pid=80) ERROR ValueError: To serve at least one request with the model's max seq len (262144), (8.50 GiB KV cache is needed",
        "RuntimeError: Engine core initialization failed. See root cause above. Failed core proc(s): {}",
      ],
      "it exited with code 1",
    ),
    "ValueError: To serve at least one request with the model's max seq len (262144), (8.50 GiB KV cache is needed",
  );
  assert.equal(vllmError(["INFO bye"], "it exited with code 1"), "it exited with code 1");
});

test("a start whose cache holds the requests serves at once, after the probe", async () => {
  const server = fakeVllm({ available: 1_700_000 });
  const logs: string[] = [];
  const fit = await prepareVllm(server, MODEL, (line) => logs.push(line), options);
  assert.deepEqual(server.starts, ["auto"]);
  assert.equal(server.probes, 1);
  assert.equal(fit.contextLength, 262_144);
  assert.equal(fit.modelContextLength, 262_144);
  assert.equal(fit.loads, 1);
  assert.equal(fit.source, "search");
  assert.ok(fit.concurrency >= 4 && fit.parallel === 4 && fit.requestedParallel === 4);
  assert.equal(fit.toolCallParser, "qwen3_xml");
  assert.ok(logs.some((line) => line.includes("its K/V cache holds 6.48 requests of it")));
});

test("a cache that holds fewer requests restarts vLLM with a context that holds them", async () => {
  // A hybrid model: each request also takes a fixed state, so the first guess falls short.
  const server = fakeVllm({ available: 500_000, fixed: 20_000 });
  const fit = await prepareVllm(server, MODEL, () => {}, { ...options, maxNumSeqs: 3 });
  assert.equal(server.starts[0], "auto");
  assert.ok(server.starts.length <= 3, String(server.starts));
  assert.ok(fit.concurrency >= 3, String(fit.concurrency));
  assert.equal(fit.contextLength % 4096, 0);
  assert.equal(fit.contextLength, Math.floor((500_000 / 3 - 20_000) / 4096) * 4096);
  assert.equal(fit.source, "search");
  assert.equal(fit.loads, server.starts.length);
});

test("the next context comes from the cache's tokens, then from two measures", () => {
  const one = { contextLength: 262_144, cacheTokens: 480_000, concurrency: 480_000 / 262_144 };
  assert.equal(nextContext([one], 3), Math.floor(160_000 / 4096) * 4096);
  const two = { contextLength: 159_744, cacheTokens: 159_744 * 2.8, concurrency: 2.8 };
  assert.ok(nextContext([one, two], 3) < two.contextLength);
});

test("below the floor, the start fails saying what to change", async () => {
  const server = fakeVllm({ available: 200_000 });
  await assert.rejects(
    prepareVllm(server, MODEL, () => {}, { ...options, maxNumSeqs: 10 }),
    (error: unknown) =>
      error instanceof VllmFitFailure &&
      error.message.startsWith(
        "`unsloth/Qwen3.8-27B-NVFP4` does not fit the GPU with 10 parallel requests and a context of 64000 tokens, the least Codeman gives an agent:",
      ) &&
      error.message.includes("set a smaller `max-num-seqs`, set `kv-cache-dtype: fp8`"),
  );
  assert.equal(server.probes, 0);
  const tiny = fakeVllm({ available: 10_000, fixed: 20_000 });
  await assert.rejects(
    prepareVllm(tiny, MODEL, () => {}, options),
    /vLLM did not start `unsloth\/Qwen3.8-27B-NVFP4`: ValueError: Cannot auto-fit max_model_len/,
  );
});

test("an explicit context: vLLM's refusal is relayed, and one too small for the requests fails", async () => {
  const refused = fakeVllm({ available: 200_000 });
  await assert.rejects(
    prepareVllm(refused, MODEL, () => {}, { ...options, configured: 262_144 }),
    (error: unknown) =>
      error instanceof VllmFitFailure &&
      error.message.startsWith(
        "vLLM did not start `unsloth/Qwen3.8-27B-NVFP4` with a context of 262144 tokens: ValueError: To serve at least one request",
      ) &&
      error.message.endsWith("or use a GPU with more memory."),
  );
  assert.deepEqual(refused.starts, [262_144], "no fit around an explicit context");
  const few = fakeVllm({ available: 500_000 });
  await assert.rejects(
    prepareVllm(few, MODEL, () => {}, { ...options, configured: 262_144, maxNumSeqs: 3 }),
    /does not fit the GPU with 3 parallel requests and a context of 262144 tokens: vLLM's K\/V cache holds 1\.91 of them/,
  );
  const fits = fakeVllm({ available: 500_000 });
  const fit = await prepareVllm(fits, MODEL, () => {}, { ...options, configured: 65_536 });
  assert.equal(fit.source, "settings");
  assert.equal(fit.contextLength, 65_536);
});

test("the cached context is used when it holds the requests, and fitted again when not", async () => {
  const cached = fakeVllm({ available: 1_700_000 });
  const fit = await prepareVllm(cached, MODEL, () => {}, { ...options, hint: 131_072 });
  assert.deepEqual(cached.starts, [131_072]);
  assert.equal(fit.source, "cache");
  assert.equal(fit.modelContextLength, undefined);
  const refused = fakeVllm({ available: 200_000 });
  const again = await prepareVllm(refused, MODEL, () => {}, {
    ...options,
    maxNumSeqs: 2,
    hint: 262_144,
  });
  assert.deepEqual(refused.starts.slice(0, 2), [262_144, "auto"]);
  assert.equal(again.source, "search");
  const short = fakeVllm({ available: 500_000 });
  const smaller = await prepareVllm(short, MODEL, () => {}, { ...options, hint: 262_144 });
  assert.equal(short.starts[0], 262_144);
  assert.ok(smaller.concurrency >= 4 && smaller.source === "search");
});

test("a probe without a parsed tool call fails the start, naming the parser", async () => {
  const server = fakeVllm({ available: 1_700_000, toolCalls: false });
  await assert.rejects(
    prepareVllm(server, MODEL, () => {}, options),
    (error: unknown) =>
      error instanceof VllmFitFailure &&
      error.message ===
        "vLLM did not return a tool call with the parser `qwen3_xml`: it may not match `unsloth/Qwen3.8-27B-NVFP4` (it answered without a parsed tool call). Set the `tool-call-parser` that the model's card or vLLM's recipe gives in the `vllm` settings.",
  );
  assert.equal(server.probes, 2);
});

test("a pod reads its engine, its vLLM settings and its cached context", () => {
  const base = {
    CODEMAN_MODEL: MODEL,
    CODEMAN_ADMIN_SHA256: "a".repeat(64),
    CODEMAN_START_BY: "2026-10-13T12:00:00Z",
  };
  const settings = podSettings({
    ...base,
    CODEMAN_ENGINE: "vllm",
    CODEMAN_IMAGE_ENGINE: "vllm",
    CODEMAN_VLLM: '{"max-num-seqs":"4","tool-call-parser":"qwen3_xml"}',
    CODEMAN_FIT: '{"contextLength":131072}',
  });
  assert.equal(settings.engine, "vllm");
  assert.equal(settings.imageEngine, "vllm");
  assert.deepEqual(settings.vllm, {
    ok: true,
    value: { "max-num-seqs": "4", "tool-call-parser": "qwen3_xml" },
  });
  assert.equal(settings.contextHint, 131072);
  assert.equal(settings.fitHint, undefined, "an Ollama hint needs a digest");
  const old = podSettings(base);
  assert.equal(old.engine, "ollama");
  assert.equal(old.imageEngine, "ollama");
  assert.deepEqual(old.vllm, { ok: true, value: {} });
  assert.equal(
    podSettings({ ...base, CODEMAN_VLLM: '{"host":"0.0.0.0"}' }).vllm.ok,
    false,
    "an argument Codeman sets itself",
  );
});

test("vLLM starts only on a driver with the CUDA its image needs, or one that does not say", async () => {
  const header = (version: string) =>
    `| NVIDIA-SMI 580.65.06   Driver Version: 580.65.06   CUDA Version: ${version}     |`;
  assert.equal(driverCudaVersion(header("13.0")), "13.0");
  assert.equal(driverCudaVersion("No devices were found"), undefined);
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  await checkDriverCuda(async () => header("13.1"), log);
  await checkDriverCuda(async () => header("14.0"), log);
  await assert.rejects(
    checkDriverCuda(async () => header("12.8"), log),
    /driver supports CUDA 12\.8, older than the 13\.0/,
  );
  await checkDriverCuda(async () => "No devices were found", log);
  await checkDriverCuda(async () => {
    throw new Error("spawn nvidia-smi ENOENT");
  }, log);
  assert.match(logs.at(-2) ?? "", /no CUDA version; starting vLLM anyway/);
  assert.match(logs.at(-1) ?? "", /Could not read .*ENOENT.*starting vLLM anyway/);
});
