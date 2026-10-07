import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt } from "../crypto.ts";
import { ProviderBudget } from "../inference/budget.ts";
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
    "ledger-run": "300-1-7",
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

test("with several tasks, the month keeps what those picked before may spend", async () => {
  const choice = (reserved: number) =>
    JSON.stringify({
      inference: "openrouter",
      providers: ["openrouter"],
      recorded: { spent: 0, selfHosted: 0 },
      reserved,
      others: ["3"],
    });
  // 15 used, and this run's 2: room for 3, not for 3.5.
  const fits = new FakeInference({ month: 15 });
  const opened = await open(fits, openInputs({ inference: choice(3) }));
  assert.equal(opened.outputs.status, "opened");
  assert.ok(
    opened
      .logged("info")
      .includes("Kept for the tasks this run picked before this one: up to US$ 3.00."),
  );
  const full = new FakeInference({ month: 15 });
  const refused = await open(full, openInputs({ inference: choice(3.5) }));
  assert.equal(refused.outputs.status, "over-budget");
  assert.equal(
    refused.outputs.reason,
    "The monthly budget is reached: US$ 15.00 used of US$ 20.00, up to US$ 3.50 is kept for the run's other tasks, and this run may use up to US$ 2.00.",
  );
  assert.equal(full.opened.length, 0);
});

test("the month adds up every provider the settings name, against the one budget", async () => {
  const inference = new FakeInference({ spent: 0.25, month: 12 });
  const budget = new ProviderBudget({ spent: 0.75, selfHosted: 0.5 }, [
    { name: "openrouter", provider: inference },
    { name: "runpod", month: async () => 7.5 },
  ]);
  const runtime = new FakeRuntime({ inputs: openInputs(), runId: "300" });
  await openKey(fakeServices(new FakePlatform(), runtime, undefined, inference, budget));
  assert.equal(runtime.outputs.status, "over-budget", "12 + 7.5 + the run's 1.25 pass 20");
  assert.equal(runtime.outputs["task-spent"], "0.7500");
  assert.equal(runtime.outputs["month-spent"], "19.5000");
  assert.ok(
    runtime
      .logged("info")
      .includes(
        "Usage this month (openrouter US$ 12.00, runpod US$ 7.50): US$ 19.50 of US$ 20.00.",
      ),
  );
  assert.equal(inference.opened.length, 0);
});

test("a provider the settings name without its secret opens nothing, and says which", async () => {
  const inference = new FakeInference();
  const budget = new ProviderBudget({ spent: 0, selfHosted: 0 }, [], ["CODEMAN_RUNPOD_API_KEY"]);
  const runtime = new FakeRuntime({
    inputs: openInputs({
      inference:
        '{"inference":"openrouter","profile":"plan-or","providers":["openrouter","runpod"],"recorded":{"spent":0,"selfHosted":0}}',
    }),
  });
  await openKey(fakeServices(new FakePlatform(), runtime, undefined, inference, budget));
  assert.equal(runtime.outputs.status, "missing-credentials");
  assert.match(runtime.outputs.reason ?? "", /`CODEMAN_RUNPOD_API_KEY`/);
  assert.ok(runtime.logged("info").includes("The run uses the inference profile `plan-or`."));
  assert.equal(inference.opened.length, 0);
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
  const runtime = new FakeRuntime({ inputs: { handle: "h", "ledger-run": "300-1-7" } });
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

test("an older workflow file passes the handle as key-hash: the run closes, then the ledger asks for the templates", async () => {
  const inference = new FakeInference({ usage: { cost: 0 } });
  const runtime = new FakeRuntime({ inputs: { "key-hash": "old" } });
  await assert.rejects(
    closeKey(fakeServices(new FakePlatform(), runtime, undefined, inference)),
    /Input ledger-run must be the run's ID in the ledger, from select; copy the workflow templates again/,
  );
  assert.deepEqual(inference.closed, ["old"]);
  assert.deepEqual(runtime.outputs, { "run-cost": "0.0000" }, "unknown figures are left out");
});
