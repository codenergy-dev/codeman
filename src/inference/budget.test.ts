import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { providerAccounts } from "./index.ts";

test("the accounts say which secret the job lacks for each provider", () => {
  const both = providerAccounts(
    new FakeRuntime({ inputs: { "management-key": "mk", "gpu-key": "rk" } }),
  );
  assert.equal(both.missing("openrouter"), undefined);
  assert.equal(both.missing("runpod"), undefined);
  const none = providerAccounts(new FakeRuntime());
  assert.equal(none.missing("openrouter"), "CODEMAN_OPENROUTER_MANAGEMENT_KEY");
  assert.equal(none.missing("runpod"), "CODEMAN_RUNPOD_API_KEY");
  assert.throws(() => none.missing("elsewhere"), /Unknown account "elsewhere"/);
});

test("without OpenRouter's key, the accounts tell no run's cost; OpenRouter bills no hours", async () => {
  const accounts = providerAccounts(new FakeRuntime({ inputs: { "gpu-key": "rk" } }));
  assert.equal(await accounts.taskCosts("7"), undefined);
  await assert.rejects(
    accounts.billedHours("openrouter", new Date(), new Date()),
    /openrouter has no hourly billing/,
  );
});
