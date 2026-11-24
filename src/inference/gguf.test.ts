import assert from "node:assert/strict";
import { test } from "node:test";
import { ggufHeader, QWEN25_05B_INFO } from "../testing/gguf.ts";
import { ggufMetadata, MAX_ARRAY } from "./gguf.ts";

test("a GGUF header gives its pairs, and skips the tokenizer's vocabulary", () => {
  const header = ggufHeader(
    { ...QWEN25_05B_INFO, "llama.attention.head_count_kv": [8, 8, 0, 8] },
    1000,
  );
  const metadata = ggufMetadata(header);
  assert.ok(metadata);
  assert.equal(metadata.complete, true);
  assert.equal(metadata.kv["general.architecture"], "qwen2");
  assert.equal(metadata.kv["qwen2.block_count"], 24);
  assert.equal(metadata.kv["qwen2.attention.head_count_kv"], 2);
  assert.deepEqual(metadata.kv["llama.attention.head_count_kv"], [8, 8, 0, 8]);
  assert.ok(!("tokenizer.ggml.tokens" in metadata.kv));
});

test("a header cut short gives the pairs before the cut", () => {
  const header = ggufHeader(QWEN25_05B_INFO, 1000);
  const metadata = ggufMetadata(header.subarray(0, header.byteLength - 100));
  assert.equal(metadata?.complete, false);
  assert.equal(metadata?.kv["qwen2.attention.head_count"], 14);
});

test("an array of numbers beyond the limit is skipped, and what is not GGUF is refused", () => {
  const long = ggufHeader({ "x.long": Array(MAX_ARRAY + 1).fill(1), "x.after": 7 });
  assert.deepEqual(ggufMetadata(long)?.kv, { "x.after": 7 });
  assert.equal(ggufMetadata(new TextEncoder().encode("PK\u0003\u0004 not gguf")), undefined);
  const version1 = ggufHeader({});
  new DataView(version1.buffer).setUint32(4, 1, true);
  assert.equal(ggufMetadata(version1), undefined);
});
