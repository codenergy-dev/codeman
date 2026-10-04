import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt } from "../crypto.ts";
import { FakeInference } from "../testing/fake-inference.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { closeKey, openKey } from "./keys.ts";

const secret = "s".repeat(32);

function openInputs(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "encryption-secret": secret,
    task: "7",
    "task-budget": "2",
    "monthly-budget": "20",
    ...extra,
  };
}

async function open(inference: FakeInference, inputs = openInputs()) {
  const runtime = new FakeRuntime({ inputs, runId: "300" });
  await openKey(fakeServices(new FakePlatform(), runtime, undefined, inference));
  return runtime;
}

test("opens a run limited to what remains of the task's budget", async () => {
  const inference = new FakeInference({ spent: 0.25, month: 3 });
  const runtime = await open(inference);
  assert.deepEqual(inference.opened, [{ task: "7", runId: "300", limit: 1.75 }]);
  assert.equal(runtime.outputs.status, "opened");
  assert.equal(runtime.outputs["key-limit"], "1.75");
  assert.equal(runtime.outputs["task-spent"], "0.2500");
  assert.equal(runtime.outputs["month-spent"], "3.0000");
  assert.equal(runtime.outputs.handle, "handle-300");
  assert.equal(runtime.outputs["key-hash"], "handle-300");
  assert.equal(decrypt(runtime.outputs["encrypted-key"] ?? "", secret), "credential-300");
  assert.deepEqual(runtime.masked, ["credential-300"]);
});

test("opens nothing when the task's budget is spent or the month's would be passed", async () => {
  const spent = new FakeInference({ spent: 1.95 });
  assert.equal((await open(spent)).outputs.status, "task-budget-spent");
  const month = new FakeInference({ month: 19 });
  const runtime = await open(month);
  assert.equal(runtime.outputs.status, "over-budget");
  assert.match(runtime.outputs.reason ?? "", /US\$ 19\.00 used of US\$ 20\.00/);
  assert.equal(spent.opened.length + month.opened.length, 0);
});

test("closes the run by its handle, and reports what it used", async () => {
  const inference = new FakeInference({
    usage: {
      cost: 0.0312,
      inputTokens: 1500,
      outputTokens: 40,
      requests: 3,
      maxInputTokens: 900,
      tokensPerSecond: 48.25,
      taskCosts: { "100": 0.1, "300": 0.0312 },
    },
  });
  const runtime = new FakeRuntime({ inputs: { handle: "h" } });
  await closeKey(fakeServices(new FakePlatform(), runtime, undefined, inference));
  assert.deepEqual(inference.closed, ["h"]);
  assert.deepEqual(runtime.outputs, {
    "run-cost": "0.0312",
    "input-tokens": "1500",
    "output-tokens": "40",
    requests: "3",
    "max-input-tokens": "900",
    "tokens-per-second": "48.3",
    "task-costs": '{"100":0.1,"300":0.0312}',
  });
});

test("an older workflow file passes the handle as key-hash; unknown figures are left out", async () => {
  const inference = new FakeInference({ usage: { cost: 0 } });
  const runtime = new FakeRuntime({ inputs: { "key-hash": "old" } });
  await closeKey(fakeServices(new FakePlatform(), runtime, undefined, inference));
  assert.deepEqual(inference.closed, ["old"]);
  assert.deepEqual(runtime.outputs, { "run-cost": "0.0000" });
});
