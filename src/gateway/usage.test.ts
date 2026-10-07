import assert from "node:assert/strict";
import { test } from "node:test";
import {
  busyMs,
  EventReader,
  meterCost,
  summarize,
  type WorkerSample,
  type Workers,
} from "./usage.ts";

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

/** Samples every 5 seconds from `from`, one per state given. */
function samples(from: number, ...states: (Workers | undefined)[]): WorkerSample[] {
  return states.map((workers, i) => ({ at: from + i * 5_000, workers }));
}

test("a cold start counts from when a worker runs: its model's load, not its pull", () => {
  // The request waits while the worker initializes, then runs from 15 to 30 seconds.
  const states = samples(
    0,
    "none",
    "starting",
    "starting",
    "running",
    "running",
    "running",
    "running",
  );
  // The 5 seconds before the first sample that saw it running count, and the idle timeout.
  assert.equal(busyMs([{ start: 0, end: 30_000 }], 5_000, 40_000, states), 25_000);
});

test("a wait without a worker counts nothing, but the idle timeout after the last sample", () => {
  const waiting = samples(0, "none", "none", "none", "none", "none");
  assert.equal(busyMs([{ start: 0 }], 0, 20_000, waiting), 0);
  // Throttled, scaled down or crashed: none is billed, and none ran for this run.
  assert.equal(busyMs([{ start: 0, end: 20_000 }], 5_000, 99_999, waiting), 5_000);
});

test("an idle timeout between requests counts only while a worker runs", () => {
  const requests = [
    { start: 0, end: 10_000 },
    { start: 20_000, end: 30_000 },
  ];
  // The worker scaled down before its idle timeout ended, and started again at 25 seconds.
  const states = samples(0, "running", "running", "running", "none", "none", "running", "running");
  assert.equal(busyMs(requests, 15_000, 99_999, states), 40_000);
  const kept = samples(0, "running", "running", "running", "running", "running", "running");
  assert.equal(busyMs(requests, 15_000, 99_999, kept), 45_000);
});

test("a worker serving another repository counts only while this run has a request open", () => {
  const busy = samples(0, ...Array<Workers>(30).fill("running"));
  assert.equal(busyMs([{ start: 50_000, end: 60_000 }], 5_000, 150_000, busy), 15_000);
});

test("time a sample could not tell counts, as without samples", () => {
  const requests = [{ start: 0, end: 30_000 }];
  const unknown = samples(0, undefined, undefined, undefined, undefined, undefined, undefined);
  assert.equal(busyMs(requests, 5_000, 99_999, unknown), busyMs(requests, 5_000, 99_999));
  const gap = samples(0, "none", "none", undefined, "none", "none", "none", "none");
  assert.equal(busyMs(requests, 5_000, 99_999, gap), 15_000);
});

test("a pod costs its time; a worker its busy time", () => {
  assert.equal(meterCost({ kind: "time", pricePerSecond: 0.5 }, 1_000, [], 11_000), 5);
  assert.equal(
    meterCost({ kind: "busy", pricePerSecond: 0.5, idleMs: 0 }, 0, [{ start: 0, end: 4_000 }], 99),
    2,
  );
  const none = samples(0, "none", "none");
  const busy = { kind: "busy" as const, pricePerSecond: 0.5, idleMs: 0 };
  assert.equal(meterCost(busy, 0, [{ start: 0, end: 4_000 }], 99, none), 0);
});

test("sums requests as OpenRouter reports a key's: tokens, largest prompt and streamed throughput", () => {
  const usage = summarize(
    [
      { start: 0, streamed: true, firstByte: 1_000, end: 3_000, input: 1_000, output: 100 },
      { start: 5_000, streamed: true, firstByte: 5_500, end: 6_500, input: 3_000, output: 20 },
      { start: 7_000, end: 7_100 },
      // A plain response arrives whole: its tokens count, not its speed.
      { start: 8_000, firstByte: 8_900, end: 8_901, input: 10, output: 50 },
    ],
    { kind: "time", pricePerSecond: 0.001 },
    0,
    10_000,
  );
  assert.deepEqual(usage, {
    requests: 4,
    inputTokens: 4_010,
    outputTokens: 170,
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
