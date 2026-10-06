import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeGpu } from "../testing/fake-gpu.ts";
import { deadline, type Endpoint, endpointProblems, podCost, waitUntilReady } from "./gpu.ts";

const fine: Endpoint = {
  id: "ep1",
  type: "QUEUE",
  workersMin: 0,
  workersMax: 1,
  idleTimeoutSeconds: 5,
  gpuCount: 1,
  env: {},
};

test("accepts an endpoint with flex workers only, one at most, and an idle timeout of 5 minutes at most", () => {
  assert.deepEqual(endpointProblems(fine), []);
  assert.deepEqual(endpointProblems({ ...fine, idleTimeoutSeconds: 300 }), []);
});

test("refuses an endpoint that bills when idle or may run several workers", () => {
  const problems = endpointProblems({
    ...fine,
    type: "LOAD_BALANCER",
    workersMin: 1,
    workersMax: 3,
    idleTimeoutSeconds: 600,
  });
  assert.equal(problems.length, 4);
  assert.match(problems[0] ?? "", /queue-based/);
  assert.match(problems[1] ?? "", /active worker/);
  assert.match(problems[2] ?? "", /set max workers to 1/);
  assert.match(problems[3] ?? "", /600 seconds; set it to 300 seconds or less/);
  assert.match(endpointProblems({ ...fine, workersMax: 0 })[0] ?? "", /7 days without requests/);
  assert.match(endpointProblems({ ...fine, idleTimeoutSeconds: undefined })[0] ?? "", /unknown/);
});

test("a run's deadline is when the pod's price adds up to its limit", () => {
  const start = new Date("2026-10-03T12:00:00Z");
  // US$ 0.72 per hour: US$ 1.80 lasts two and a half hours.
  assert.deepEqual(deadline(start, 1.8, 0.0002), new Date("2026-10-03T14:30:00Z"));
  assert.throws(() => deadline(start, 1, 0), /positive/);
  assert.ok(Math.abs(podCost(start, new Date("2026-10-03T12:30:00Z"), 0.0002) - 0.36) < 1e-12);
  assert.equal(podCost(start, new Date("2026-10-03T11:00:00Z"), 0.0002), 0);
});

const noWait = async () => undefined;

test("waits until the pod runs and its service answers", async () => {
  const gpu = new FakeGpu();
  gpu.startAfter = 2;
  const pod = await gpu.pods.create({
    name: "n",
    image: "i",
    env: {},
    port: 8080,
    gpuType: "GPU-A",
    diskGb: 1,
  });
  let asked = 0;
  const ready = await waitUntilReady(gpu.pods, pod.id, async () => ++asked > 1, {
    timeoutMs: 60_000,
    intervalMs: 10_000,
    wait: noWait,
  });
  assert.equal(ready.status, "running");
  assert.equal(asked, 2, "asked only once the pod runs");
});

test("stops waiting for a pod that fails, disappears or takes too long", async () => {
  const gpu = new FakeGpu();
  const spec = { name: "n", image: "i", env: {}, port: 8080, gpuType: "GPU-A", diskGb: 1 };
  const failed = await gpu.pods.create(spec);
  gpu.setStatus(failed.id, "failed");
  const options = { timeoutMs: 30_000, intervalMs: 10_000, wait: noWait };
  await assert.rejects(
    waitUntilReady(gpu.pods, failed.id, async () => true, options),
    /failed/,
  );
  await assert.rejects(
    waitUntilReady(gpu.pods, "gone", async () => true, options),
    /no longer/,
  );
  const slow = await gpu.pods.create(spec);
  await assert.rejects(
    waitUntilReady(gpu.pods, slow.id, async () => false, options),
    /not ready within 1 minutes/,
  );
});
