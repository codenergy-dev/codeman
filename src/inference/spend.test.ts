import assert from "node:assert/strict";
import { test } from "node:test";
import { countRun, MAX_PODS, parsePodCosts } from "./spend.ts";

test("a run on a new pod adds its estimate, and the pod's billing replaces it once higher", () => {
  const first = countRun(undefined, { runId: "100", cost: 0.3, pod: "a" });
  assert.deepEqual(first, {
    pods: [{ id: "a", runs: ["100"], counted: 0.3 }],
    added: 0.3,
    costs: {},
  });
  const billed = countRun(first.pods, { runId: "101", cost: 0.1 }, { a: 0.35 });
  assert.ok(
    Math.abs(billed.added - 0.15) < 1e-9,
    "the Serverless run, and the pod's billing above",
  );
  assert.deepEqual(billed.costs, { "100": 0.35 });
  const lower = countRun(billed.pods, { runId: "102", cost: 0 }, { a: 0.2 });
  assert.equal(lower.added, 0, "billing that lags counts nothing less");
});

test("a kept pod's runs add up, and its idle time shows in its billing, not in a run", () => {
  let pods = countRun(undefined, { runId: "100", cost: 0.3, pod: "a" }).pods;
  const second = countRun(pods, { runId: "101", cost: 0.2, pod: "a" }, { a: 0.6 });
  pods = second.pods;
  assert.deepEqual(pods, [{ id: "a", runs: ["100", "101"], counted: 0.6 }]);
  assert.ok(Math.abs(second.added - 0.3) < 1e-9);
  assert.deepEqual(second.costs, {}, "a pod that served two runs refreshes no row");
});

test("a shared pod is marked, and counts the task's share that close-key reports for it", () => {
  const first = countRun(
    undefined,
    { runId: "100", cost: 0.06, pod: "a", shared: true },
    { a: 0.06 },
  );
  assert.deepEqual(first.pods, [{ id: "a", runs: ["100"], counted: 0.06, shared: true }]);
  // The next run's share, and the kept time between the runs given to the task.
  const second = countRun(
    first.pods,
    { runId: "101", cost: 0.06, pod: "a", shared: true },
    {
      a: 0.18,
    },
  );
  assert.ok(Math.abs(second.added - 0.12) < 1e-9);
  assert.equal(second.pods[0]?.counted, 0.18);
});

test("keeps the newest pods only", () => {
  let pods = countRun(undefined, { runId: "0", cost: 0, pod: "p0" }).pods;
  for (let index = 1; index <= MAX_PODS; index++) {
    pods = countRun(pods, { runId: String(index), cost: 0, pod: `p${index}` }).pods;
  }
  assert.equal(pods.length, MAX_PODS);
  assert.equal(pods[0]?.id, "p1");
});

test("reads close-key's billing of pods", () => {
  assert.deepEqual(parsePodCosts('{"abc123":0.42}'), { abc123: 0.42 });
  assert.equal(parsePodCosts(""), undefined);
  assert.equal(parsePodCosts('{"a b":1}'), undefined);
  assert.equal(parsePodCosts('{"a":-1}'), undefined);
});
