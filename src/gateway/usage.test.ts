import assert from "node:assert/strict";
import { test } from "node:test";
import { busyMs, EventReader, meterCost, summarize } from "./usage.ts";

test("a worker is up for the union of its requests, each followed by its idle timeout", () => {
  assert.equal(busyMs([], 5_000, 0), 0);
  assert.equal(busyMs([{ start: 0, end: 10_000 }], 5_000, 99_999), 15_000);
  // Two requests 3 seconds apart share the idle time between them.
  assert.equal(
    busyMs(
      [
        { start: 13_000, end: 20_000 },
        { start: 0, end: 10_000 },
      ],
      5_000,
      0,
    ),
    25_000,
  );
  // Far apart, each pays its own idle time; a running request counts until now.
  assert.equal(busyMs([{ start: 0, end: 10_000 }, { start: 60_000 }], 5_000, 70_000), 30_000);
});

test("a pod costs its time; a worker its busy time", () => {
  assert.equal(meterCost({ kind: "time", pricePerSecond: 0.5 }, 1_000, [], 11_000), 5);
  assert.equal(
    meterCost({ kind: "busy", pricePerSecond: 0.5, idleMs: 0 }, 0, [{ start: 0, end: 4_000 }], 99),
    2,
  );
});

test("sums requests as OpenRouter reports a key's: tokens, largest prompt and mean throughput", () => {
  const usage = summarize(
    [
      { start: 0, firstByte: 1_000, end: 3_000, input: 1_000, output: 100 },
      { start: 5_000, firstByte: 5_500, end: 6_500, input: 3_000, output: 20 },
      { start: 7_000, end: 7_100 },
    ],
    { kind: "time", pricePerSecond: 0.001 },
    0,
    10_000,
  );
  assert.deepEqual(usage, {
    requests: 3,
    inputTokens: 4_000,
    outputTokens: 120,
    maxInputTokens: 3_000,
    tokensPerSecond: 35,
    cost: 0.01,
    start: 0,
    end: 10_000,
  });
});

test("reads JSON events across chunks, and knows when a comment may go between them", () => {
  const seen: unknown[] = [];
  const reader = new EventReader((data) => seen.push(data));
  assert.ok(reader.atBoundary);
  reader.feed('data: {"a"');
  assert.ok(!reader.atBoundary);
  reader.feed(":1}\n");
  assert.ok(!reader.atBoundary);
  reader.feed("\ndata: not json\n\ndata: [DONE]\n\n");
  assert.ok(reader.atBoundary);
  assert.deepEqual(seen, [{ a: 1 }]);
});
