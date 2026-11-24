import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QWEN25_05B_CONFIG,
  QWEN25_05B_INFO,
  QWEN25_05B_SAFETENSORS,
  QWEN25_05B_WEIGHTS,
} from "../testing/gguf.ts";
import {
  estimateMessage,
  estimateOllama,
  estimateVllm,
  vllmKvBytesPerToken,
  vllmModelContext,
} from "./estimate.ts";

const GIB = 2 ** 30;

test("vLLM's bytes per token come from config.json, as vLLM counts a full-attention layer", () => {
  // 2 × 24 layers × 2 K/V heads × a head of 896 / 14 = 64 × 2 bytes.
  assert.equal(vllmKvBytesPerToken(QWEN25_05B_CONFIG, undefined), 12_288);
  assert.equal(vllmKvBytesPerToken(QWEN25_05B_CONFIG, "auto"), 12_288);
  assert.equal(vllmKvBytesPerToken(QWEN25_05B_CONFIG, "fp8"), 6_144);
  assert.equal(vllmKvBytesPerToken(QWEN25_05B_CONFIG, "fp8_e5m2"), 6_144);
  // An explicit head_dim wins over hidden_size / heads, as Qwen3's.
  assert.equal(
    vllmKvBytesPerToken(
      {
        num_hidden_layers: 36,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 2560,
        head_dim: 128,
      },
      undefined,
    ),
    2 * 36 * 8 * 128 * 2,
  );
  // Without num_key_value_heads, every head has its own K/V.
  assert.equal(
    vllmKvBytesPerToken({ num_hidden_layers: 2, num_attention_heads: 4, hidden_size: 256 }, "fp8"),
    2 * 2 * 4 * 64,
  );
  // A multimodal model's language model, nested in text_config.
  assert.equal(
    vllmKvBytesPerToken({ vision_config: {}, text_config: QWEN25_05B_CONFIG }, undefined),
    12_288,
  );
  assert.equal(vllmModelContext({ text_config: QWEN25_05B_CONFIG }), 32_768);
});

test("vLLM's bytes per token are unknown for what one cache per layer does not count", () => {
  const cases: Record<string, unknown>[] = [
    { ...QWEN25_05B_CONFIG, use_sliding_window: true },
    { ...QWEN25_05B_CONFIG, use_sliding_window: undefined, sliding_window: 4096 },
    { ...QWEN25_05B_CONFIG, layer_types: ["sliding_attention", "full_attention"] },
    { ...QWEN25_05B_CONFIG, kv_lora_rank: 512 },
    { ...QWEN25_05B_CONFIG, layers_block_type: ["mamba", "attention"] },
    { ...QWEN25_05B_CONFIG, full_attention_interval: 4 },
    { ...QWEN25_05B_CONFIG, num_hidden_layers: undefined },
    { ...QWEN25_05B_CONFIG, num_attention_heads: undefined },
    { text_config: { model_type: "x" } },
  ];
  for (const config of cases) assert.equal(vllmKvBytesPerToken(config, undefined), undefined);
  assert.equal(
    vllmKvBytesPerToken(
      { ...QWEN25_05B_CONFIG, layer_types: Array(24).fill("full_attention") },
      undefined,
    ),
    12_288,
  );
});

test("the pod check's unfit settings are refused on the GPUs whose pods failed, at no cost", () => {
  // The two pods of the e2e plan: vLLM's own measures stay under the optimistic room.
  for (const [gpuMemoryGb, measuredCacheGib] of [
    [16, 12.6],
    [24, 20.32],
  ] as const) {
    const estimate = estimateVllm({
      config: QWEN25_05B_CONFIG,
      weightsBytes: QWEN25_05B_SAFETENSORS,
      gpuMemoryGb,
      settings: { "max-model-len": "32768", "max-num-seqs": "256" },
    });
    assert.ok(estimate);
    assert.equal(estimate.needed, 256 * 32_768 * 12_288);
    assert.ok(Math.abs(estimate.needed / GIB - 96) < 1e-9);
    assert.equal(estimate.room, gpuMemoryGb * GIB * 0.92 - QWEN25_05B_SAFETENSORS);
    assert.ok(estimate.room / GIB > measuredCacheGib, "never below what vLLM measured");
    assert.equal(estimate.fits, false);
    assert.equal(estimate.floor, false);
  }
});

test("the pod check's vllm settings fit, at the floor of the model's own context", () => {
  const estimate = estimateVllm({
    config: QWEN25_05B_CONFIG,
    weightsBytes: QWEN25_05B_SAFETENSORS,
    gpuMemoryGb: 24,
    settings: { "max-num-seqs": "1" },
  });
  assert.deepEqual(
    estimate && { context: estimate.context, floor: estimate.floor, fits: estimate.fits },
    { context: 32_768, floor: true, fits: true },
  );
  // A larger model's floor is 64000 tokens.
  const large = estimateVllm({
    config: { ...QWEN25_05B_CONFIG, max_position_embeddings: 131_072 },
    weightsBytes: QWEN25_05B_SAFETENSORS,
    gpuMemoryGb: 24,
    settings: {},
  });
  assert.equal(large?.context, 64_000);
  assert.equal(large?.parallel, 1);
});

test("vLLM's estimate follows gpu-memory-utilization, and gives up without what it needs", () => {
  const base = {
    config: QWEN25_05B_CONFIG,
    weightsBytes: QWEN25_05B_SAFETENSORS,
    gpuMemoryGb: 16,
  };
  const half = estimateVllm({ ...base, settings: { "gpu-memory-utilization": "0.5" } });
  assert.equal(half?.budget, 8 * GIB);
  assert.equal(estimateVllm({ ...base, gpuMemoryGb: undefined, settings: {} }), undefined);
  assert.equal(
    estimateVllm({
      ...base,
      config: { ...QWEN25_05B_CONFIG, max_position_embeddings: undefined },
      settings: {},
    }),
    undefined,
  );
  // An explicit max-model-len needs no context of the model's own.
  assert.equal(
    estimateVllm({
      ...base,
      config: { ...QWEN25_05B_CONFIG, max_position_embeddings: undefined },
      settings: { "max-model-len": "8192" },
    })?.context,
    8192,
  );
});

test("Ollama's estimate counts the gateway's bytes per token, the fit's margin and the overhead", () => {
  const fits = estimateOllama({
    info: QWEN25_05B_INFO,
    weightsBytes: QWEN25_05B_WEIGHTS,
    gpuMemoryGb: 16,
    variables: { OLLAMA_NUM_PARALLEL: "1" },
  });
  assert.ok(fits);
  assert.deepEqual(
    { perToken: fits.perToken, context: fits.context, floor: fits.floor, fits: fits.fits },
    { perToken: 12_288, context: 32_768, floor: true, fits: true },
  );
  assert.equal(fits.room, 16 * GIB - GIB - QWEN25_05B_WEIGHTS);
  // The e2e suite's fit-floor: two requests on a GPU of 1 GB.
  const floor = estimateOllama({
    info: QWEN25_05B_INFO,
    weightsBytes: QWEN25_05B_WEIGHTS,
    gpuMemoryGb: 1,
    variables: { OLLAMA_NUM_PARALLEL: "2" },
  });
  assert.equal(floor?.fits, false);
  assert.equal(floor?.parallel, 2);
  const explicit = estimateOllama({
    info: QWEN25_05B_INFO,
    weightsBytes: QWEN25_05B_WEIGHTS,
    gpuMemoryGb: 16,
    variables: {
      OLLAMA_CONTEXT_LENGTH: "8192",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
      OLLAMA_GPU_OVERHEAD: String(2 * GIB),
    },
  });
  assert.deepEqual(
    explicit && {
      context: explicit.context,
      floor: explicit.floor,
      perToken: explicit.perToken,
      budget: explicit.budget,
    },
    { context: 8192, floor: false, perToken: (12_288 * 34) / 64, budget: 13 * GIB },
  );
});

test("Ollama's estimate serves a serial family one request at a time, and gives up when it cannot count", () => {
  const serial = estimateOllama({
    info: {
      ...Object.fromEntries(
        Object.entries(QWEN25_05B_INFO).map(([key, value]) => [
          key.replace(/^qwen2\./, "qwen35."),
          value,
        ]),
      ),
      "general.architecture": "qwen35",
    },
    weightsBytes: QWEN25_05B_WEIGHTS,
    gpuMemoryGb: 16,
    variables: { OLLAMA_NUM_PARALLEL: "8" },
  });
  assert.equal(serial?.parallel, 1);
  for (const info of [
    {},
    { ...QWEN25_05B_INFO, "qwen2.attention.sliding_window": 4096 },
    { ...QWEN25_05B_INFO, "qwen2.context_length": undefined },
    { ...QWEN25_05B_INFO, "qwen2.attention.head_count_kv": undefined, "qwen2.block_count": 0 },
  ]) {
    assert.equal(
      estimateOllama({
        info,
        weightsBytes: QWEN25_05B_WEIGHTS,
        gpuMemoryGb: 16,
        variables: {},
      }),
      undefined,
    );
  }
  assert.equal(
    estimateOllama({
      info: QWEN25_05B_INFO,
      weightsBytes: QWEN25_05B_WEIGHTS,
      gpuMemoryGb: undefined,
      variables: {},
    }),
    undefined,
  );
});

test("the message gives the estimate's numbers, then the levers of each case", () => {
  const unfit = estimateVllm({
    config: QWEN25_05B_CONFIG,
    weightsBytes: QWEN25_05B_SAFETENSORS,
    gpuMemoryGb: 16,
    settings: { "max-model-len": "32768", "max-num-seqs": "256" },
  });
  assert.ok(unfit);
  assert.equal(
    estimateMessage("Qwen/Qwen2.5-0.5B-Instruct", 16, unfit),
    "`Qwen/Qwen2.5-0.5B-Instruct` does not fit the GPU with 256 parallel requests and a context of 32768 tokens, by Codeman's estimate, so no pod was created: its K/V cache needs 96.00 GiB, and the GPU's 16 GB at vLLM's memory utilization, less 0.92 GiB of weights, leave at most 13.80 GiB. Lower `max-model-len` or `max-num-seqs` in the `vllm` settings, set `kv-cache-dtype: fp8` or `language-model-only: true`, or use a GPU with more memory.",
  );
  const floor = estimateOllama({
    info: QWEN25_05B_INFO,
    weightsBytes: QWEN25_05B_WEIGHTS,
    gpuMemoryGb: 1,
    variables: { OLLAMA_NUM_PARALLEL: "2" },
  });
  assert.ok(floor);
  const message = estimateMessage("qwen2.5:0.5b", 1, floor);
  assert.match(
    message,
    /^`qwen2\.5:0\.5b` does not fit the GPU with 2 parallel requests and a context of 32768 tokens, the least Codeman gives an agent, by Codeman's estimate, so no pod was created: its K\/V cache needs 0\.75 GiB, and the GPU's 1 GB, less llama\.cpp's margin of 1 GiB, the settings' overhead and 0\.37 GiB of weights, leave nothing\. Give the profile fewer tasks/,
  );
  assert.match(
    message,
    /use a smaller quantization of the model, or use a GPU with more memory\.$/,
  );
});
