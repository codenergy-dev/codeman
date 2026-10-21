import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "../../src/store/memory.ts";
import { type CheckContext, check, matches, vllmMetrics } from "./expect.ts";
import type { Expectation } from "./scenario/schema.ts";

/** The ledger's Serverless split check, on a store in memory: it reads no fake. */

const PRICE = 0.001;

/** Two runs on endpoint `e1`: A billed from 0 to 600 s, B from 300 to 900 s (serverless.md). */
async function ledger(costs: { a: number; b: number }, bFrom = 300_000, aCost = costs.a) {
  const store = new MemoryStore();
  const run = (id: string, task: number, cost: number) => ({
    op: "set" as const,
    path: `organizations/acme/runs/${id}`,
    fields: {
      repository: "acme/app",
      task,
      workflowRun: id.split("-")[0] ?? "",
      attempt: 1,
      status: "closed",
      provider: "runpod-serverless",
      endpoint: "e1",
      cost,
    },
  });
  const endpointRun = (id: string, task: number, from: number, to: number, share: number) => ({
    op: "set" as const,
    path: `pools/acme/endpoints/e1/runs/${id}-0`,
    fields: {
      run: id,
      repository: "acme/app",
      task,
      busy: JSON.stringify([[from, to]]),
      pricePerSecond: PRICE,
      estimate: ((to - from) / 1000) * PRICE,
      share,
    },
  });
  await store.write([
    { op: "set", path: "organizations/acme", fields: { pool: "acme" } },
    run("9001-1-1", 1, aCost),
    run("9001-1-2", 2, costs.b),
    endpointRun("9001-1-1", 1, 0, 600_000, costs.a),
    endpointRun("9001-1-2", 2, bFrom, bFrom + 600_000, costs.b),
  ]);
  const context = {
    store,
    issues: new Map([
      ["i1", { repo: "acme/app", number: 1 }],
      ["i2", { repo: "acme/app", number: 2 }],
    ]),
    pods: new Map(),
  } as unknown as CheckContext;
  const expectation = {
    ledger: { splitOn: "e1", costAtMost: undefined, costAtLeast: undefined, runs: undefined },
  } as unknown as Expectation;
  return check(expectation, context);
}

test("runs that split an endpoint's worker pass: shares add up to its billed time", async () => {
  assert.deepEqual(await ledger({ a: 0.45, b: 0.45 }), []);
});

test("runs that each count their own estimate fail the split check", async () => {
  const problems = await ledger({ a: 0.6, b: 0.6 });
  assert.ok(
    problems.some((problem) => /add up to 1\.2, not the worker's billed time, 0\.9/.test(problem)),
    problems.join("\n"),
  );
});

test("runs that did not overlap fail the split check", async () => {
  const problems = await ledger({ a: 0.6, b: 0.6 }, 600_000);
  assert.ok(
    problems.some((problem) => /did not overlap/.test(problem)),
    problems.join("\n"),
  );
});

test("a closed run whose cost is not its share fails", async () => {
  const problems = await ledger({ a: 0.45, b: 0.45 }, 300_000, 0.6);
  assert.deepEqual(problems, ["Run 9001-1-1 costs 0.6, not its share 0.45."]);
});

test("vLLM's metrics keep each sample apart, and an info gauge gives its labels", () => {
  const model = 'model_name="Qwen/Qwen2.5-0.5B-Instruct",engine="0"';
  const metrics = vllmMetrics(
    [
      "# HELP vllm:num_requests_running Number of requests in model execution batches.",
      "# TYPE vllm:num_requests_running gauge",
      `vllm:num_requests_running{${model}} 2.0`,
      `vllm:num_requests_waiting{${model}} 1.0`,
      `vllm:num_requests_waiting_by_reason{${model},reason="capacity"} 1.0`,
      `vllm:num_requests_waiting_by_reason{${model},reason="deferred"} 0.0`,
      `vllm:cache_config_info{block_size="128",engine="0",kv_cache_size_tokens="87296"} 1.0`,
      'python_gc_objects_collected_total{generation="0"} 1.0',
    ].join("\n"),
  );
  assert.deepEqual(metrics, {
    "vllm:num_requests_running": 2,
    "vllm:num_requests_waiting": 1,
    'vllm:num_requests_waiting_by_reason{reason="capacity"}': 1,
    'vllm:num_requests_waiting_by_reason{reason="deferred"}': 0,
    "vllm:cache_config_info": { block_size: "128", kv_cache_size_tokens: "87296" },
  });
  const pattern = {
    kind: "object" as const,
    fields: {
      "vllm:num_requests_running": { kind: "equals" as const, value: 2 },
      "vllm:cache_config_info": {
        kind: "object" as const,
        fields: { kv_cache_size_tokens: { kind: "equals" as const, value: 87296 } },
      },
    },
  };
  assert.equal(matches(pattern, metrics), undefined);
});
