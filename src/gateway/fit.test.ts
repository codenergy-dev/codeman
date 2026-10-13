import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTEXT_STEP,
  contextCandidates,
  estimateContext,
  FLOOR_CONTEXT,
  floorContext,
  kvBytesPerToken,
  onGpu,
  placementOf,
  searchContext,
} from "./fit.ts";

test("the contexts tried: the floor, multiples of 4096, and the model's own", () => {
  assert.equal(FLOOR_CONTEXT, 64000);
  assert.equal(CONTEXT_STEP, 4096);
  const contexts = contextCandidates(262144);
  assert.equal(contexts[0], 64000);
  assert.equal(contexts[1], 65536);
  assert.equal(contexts.at(-1), 262144);
  assert.ok(contexts.slice(1).every((context) => context % 4096 === 0));
  assert.equal(contexts.length, 50, "the floor, 16 to 63 × 4096, and 64 × 4096");
  assert.deepEqual(contextCandidates(100000).slice(-2), [98304, 100000], "the model's own last");
  assert.deepEqual(contextCandidates(40960), [40960], "a model below the floor: its own");
  assert.deepEqual(contextCandidates(undefined), [64000], "no context known: the floor");
  assert.equal(floorContext(32768), 32768);
});

test("the K/V cache per token, from the model's architecture", () => {
  const dense = {
    "general.architecture": "qwen3moe",
    "qwen3moe.block_count": 48,
    "qwen3moe.attention.head_count": 32,
    "qwen3moe.attention.head_count_kv": 4,
    "qwen3moe.attention.key_length": 128,
    "qwen3moe.attention.value_length": 128,
  };
  assert.equal(kvBytesPerToken(dense, undefined), 48 * 4 * 256 * 2, "f16 by default");
  assert.equal(kvBytesPerToken(dense, "q8_0"), 48 * 4 * 256 * (34 / 32));
  assert.equal(kvBytesPerToken(dense, "q4_0"), 48 * 4 * 256 * (18 / 32));
  const {
    "qwen3moe.attention.key_length": _k,
    "qwen3moe.attention.value_length": _v,
    ...rest
  } = dense;
  assert.equal(
    kvBytesPerToken({ ...rest, "qwen3moe.embedding_length": 4096 }, "f16"),
    48 * 4 * 256 * 2,
    "the head's size from the embedding",
  );
  const hybrid = {
    "general.architecture": "qwen35",
    "qwen35.block_count": 64,
    "qwen35.full_attention_interval": 4,
    "qwen35.attention.head_count": 24,
    "qwen35.attention.head_count_kv": 4,
    "qwen35.attention.key_length": 256,
    "qwen35.attention.value_length": 256,
  };
  assert.equal(kvBytesPerToken(hybrid, "f16"), 16 * 4 * 512 * 2, "one layer in 4 has attention");
  const perLayer = { ...hybrid, "qwen35.attention.head_count_kv": [0, 0, 0, 4, 0, 0, 0, 4] };
  assert.equal(kvBytesPerToken(perLayer, "f16"), 8 * 512 * 2, "the per-layer heads, summed");
  assert.equal(
    kvBytesPerToken({ ...dense, "qwen3moe.attention.sliding_window": 1024 }, "f16"),
    undefined,
    "a sliding window it cannot count",
  );
  assert.equal(kvBytesPerToken({}, "f16"), undefined);
});

test("the estimate: what the GPU holds after the weights and the margin, as a candidate", () => {
  const info = {
    "general.architecture": "qwen3moe",
    "qwen3moe.block_count": 48,
    "qwen3moe.attention.head_count_kv": 4,
    "qwen3moe.attention.key_length": 128,
    "qwen3moe.attention.value_length": 128,
  };
  const candidates = contextCandidates(262144);
  const facts = {
    info,
    size: 18_000_000_000,
    gpuMemoryGb: 96,
    parallel: 4,
    kvCacheType: undefined,
    gpuOverhead: 0,
  };
  assert.equal(estimateContext(candidates, facts), 212992);
  assert.equal(estimateContext(candidates, { ...facts, parallel: 1 }), 262144, "the model's own");
  assert.equal(estimateContext(candidates, { ...facts, gpuMemoryGb: 24 }), 64000, "the floor");
  assert.equal(estimateContext(candidates, { ...facts, gpuMemoryGb: undefined }), undefined);
  assert.equal(estimateContext(candidates, { ...facts, size: undefined }), undefined);
  assert.ok(
    (estimateContext(candidates, { ...facts, kvCacheType: "q8_0" }) ?? 0) > 212992,
    "a smaller cache holds more",
  );
});

test("the search keeps a start that fits, and halves below one that does not", async () => {
  const candidates = contextCandidates(262144);
  const tried: number[] = [];
  const fitsUpTo = (limit: number) => async (context: number) => {
    tried.push(context);
    return context <= limit;
  };
  assert.equal(await searchContext(candidates, 131072, fitsUpTo(200_000)), 131072);
  assert.deepEqual(tried, [131072]);
  tried.length = 0;
  assert.equal(await searchContext(candidates, 262144, fitsUpTo(100_000)), 98304);
  assert.ok(tried.length <= 8, `${tried.length} tries`);
  tried.length = 0;
  assert.equal(await searchContext(candidates, 262144, fitsUpTo(64000)), 64000, "the floor");
  tried.length = 0;
  assert.equal(await searchContext(candidates, 262144, fitsUpTo(1000)), undefined);
  assert.equal(tried.at(-1), 64000, "the floor is tried before giving up");
});

test("where Ollama put the model, from /api/ps", () => {
  const ps = {
    models: [
      { name: "other:1b", digest: "x", size: 10, size_vram: 10, context_length: 4096 },
      {
        name: "qwen3-coder:30b",
        digest: "d",
        size: 100,
        size_vram: 80,
        context_length: 65536,
      },
    ],
  };
  assert.deepEqual(placementOf(ps, "qwen3-coder:30b"), {
    size: 100,
    sizeVram: 80,
    contextLength: 65536,
  });
  assert.equal(placementOf(ps, "anything", "d")?.size, 100, "by digest first");
  assert.equal(placementOf({ models: [] }, "qwen3-coder:30b"), undefined);
  assert.equal(placementOf(null, "qwen3-coder:30b"), undefined);
  assert.equal(onGpu({ size: 100, sizeVram: 100, contextLength: undefined }), true);
  assert.equal(onGpu({ size: 100, sizeVram: 80, contextLength: undefined }), false);
  assert.equal(onGpu({ size: 0, sizeVram: 0, contextLength: undefined }), false, "nothing on it");
  assert.equal(onGpu(undefined), false);
});
