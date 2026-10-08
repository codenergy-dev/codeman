import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt } from "../crypto.ts";
import { OpenFailure } from "../inference/provider.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeAccounts, FakeInference } from "../testing/fake-inference.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { seedRuns } from "../testing/ledger-runs.ts";
import { closeKey, openKey } from "./keys.ts";

const secret = "s".repeat(32);
const HOUR = 3_600_000;

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

async function open(
  store: MemoryStore,
  options: {
    inference?: FakeInference;
    accounts?: FakeAccounts;
    inputs?: Record<string, string>;
    repository?: { owner: string; name: string };
  } = {},
) {
  const inference = options.inference ?? new FakeInference();
  const runtime = new FakeRuntime({
    inputs: options.inputs ?? openInputs(),
    runId: "300",
    repository: options.repository,
  });
  const services = fakeServices(
    new FakePlatform(),
    runtime,
    undefined,
    inference,
    options.accounts,
    store,
  );
  await openKey(services);
  return { runtime, inference };
}

async function run(store: MemoryStore, id: string, owner = "o") {
  return (await store.get(`organizations/${owner}/runs/${id}`))?.fields;
}

test("opens a run limited to what remains of the task's budget, reserved in the ledger", async () => {
  const store = new MemoryStore();
  await seedRuns(store, {
    "200-1-7": { status: "closed", cost: 0.25 },
    "250-1-8": { status: "closed", cost: 2.75 },
    "300-1-7": {},
  });
  const { runtime, inference } = await open(store);
  assert.deepEqual(inference.opened, [{ task: "7", runId: "300", limit: 1.75 }]);
  assert.equal(runtime.outputs.status, "opened");
  assert.equal(runtime.outputs["key-limit"], "1.75");
  assert.equal(runtime.outputs["task-spent"], "0.2500");
  assert.equal(runtime.outputs["month-spent"], "3.0000");
  assert.equal(runtime.outputs["organization-month-spent"], undefined);
  assert.equal(runtime.outputs.handle, "handle-300");
  assert.equal(runtime.outputs["key-hash"], "handle-300");
  assert.equal(decrypt(runtime.outputs["encrypted-key"] ?? "", secret), "credential-300");
  assert.deepEqual(runtime.masked, ["credential-300"]);
  const reserved = await run(store, "300-1-7");
  assert.equal(reserved?.status, "open");
  assert.equal(reserved?.limit, 1.75);
  assert.equal(reserved?.carried, 0, "the task's record counted nothing the ledger does not");
  const { reservedAt, expiresAt } = reserved ?? {};
  assert.ok(reservedAt instanceof Date && expiresAt instanceof Date);
  assert.equal(expiresAt.getTime() - reservedAt.getTime(), 2 * HOUR);
  assert.ok(reserved?.openedAt instanceof Date);
  assert.ok(
    runtime
      .logged("info")
      .includes("This month, the repository's runs count US$ 3.00 of US$ 20.00."),
  );
});

test("opens nothing when the task's budget is spent or the month's would be passed", async () => {
  const spent = new MemoryStore();
  await seedRuns(spent, { "200-1-7": { status: "closed", cost: 1.95 }, "300-1-7": {} });
  const task = await open(spent);
  assert.equal(task.runtime.outputs.status, "task-budget-spent");
  assert.equal((await run(spent, "300-1-7"))?.status, "refused");

  const month = new MemoryStore();
  await seedRuns(month, { "250-1-8": { status: "closed", cost: 19 }, "300-1-7": {} });
  const full = await open(month);
  assert.equal(full.runtime.outputs.status, "over-budget");
  assert.equal(
    full.runtime.outputs.reason,
    "The monthly budget is reached: US$ 19.00 used of US$ 20.00, and this run may use up to US$ 2.00.",
  );
  assert.deepEqual([task.inference.opened, full.inference.opened], [[], []]);
  const refused = await run(month, "300-1-7");
  assert.equal(refused?.refusal, "over-budget");
  assert.equal(refused?.limit, undefined, "a refusal reserves nothing");
});

test("two tasks that open at once near the monthly budget: one opens, the other is refused", async () => {
  const store = new MemoryStore();
  await seedRuns(store, {
    "250-1-9": { status: "closed", cost: 16.5 },
    "300-1-7": {},
    "300-1-8": {},
  });
  const [seven, eight] = await Promise.all([
    open(store),
    open(store, { inputs: openInputs({ task: "8", "ledger-run": "300-1-8" }) }),
  ]);
  const statuses = [seven.runtime.outputs.status, eight.runtime.outputs.status];
  assert.deepEqual([...statuses].sort(), ["opened", "over-budget"]);
  const refused = statuses[0] === "over-budget" ? seven : eight;
  assert.equal(
    refused.runtime.outputs.reason,
    "The monthly budget is reached: US$ 18.50 used of US$ 20.00, and this run may use up to US$ 2.00.",
    "the other task's reservation counts as used",
  );
  assert.match(
    refused.runtime.logged("info").join("\n"),
    /of which 1 open run\(s\) reserve US\$ 2\.00/,
  );
});

test("two repositories at once: each has its month, and the organization's holds them together", async () => {
  const seed = async (store: MemoryStore) =>
    seedRuns(store, {
      "250-1-9": { status: "closed", cost: 15 },
      "300-1-7": {},
      "400-1-7": { repository: "o/s", workflowRun: "400" },
    });
  const both = (store: MemoryStore, extra: Record<string, string> = {}) =>
    Promise.all([
      open(store, { inputs: openInputs(extra) }),
      open(store, {
        inputs: openInputs({ "ledger-run": "400-1-7", ...extra }),
        repository: { owner: "o", name: "s" },
      }),
    ]);

  const apart = new MemoryStore();
  await seed(apart);
  const unlimited = await both(apart);
  assert.deepEqual(
    unlimited.map((one) => one.runtime.outputs.status),
    ["opened", "opened"],
    "without an organization's budget, other repositories' runs count in theirs only",
  );

  const together = new MemoryStore();
  await seed(together);
  const limited = await both(together, { "organization-monthly-budget": "18" });
  const statuses = limited.map((one) => one.runtime.outputs.status).sort();
  assert.deepEqual(statuses, ["opened", "over-organization-budget"]);
  const refused = limited.find((one) => one.runtime.outputs.status !== "opened");
  assert.equal(
    refused?.runtime.outputs.reason,
    "The organization's monthly budget is reached: US$ 17.00 used of US$ 18.00, and this run may use up to US$ 2.00.",
  );
  assert.equal(refused?.runtime.outputs["organization-month-spent"], "17.0000");
});

test("a run that never closes counts its limit; once expired, OpenRouter's keys tell its cost", async () => {
  const now = Date.now();
  const store = new MemoryStore();
  await seedRuns(store, {
    // A cancelled run: open-key reserved its limit, and no close-key followed.
    "100-1-7": {
      status: "open",
      limit: 1.5,
      reservedAt: new Date(now - 3 * HOUR),
      expiresAt: new Date(now - HOUR),
    },
    // Another task's run, open now.
    "290-1-8": {
      status: "open",
      limit: 1,
      reservedAt: new Date(now - 60_000),
      expiresAt: new Date(now + HOUR),
    },
    "300-1-7": {},
  });
  // Without OpenRouter's key, the expired run counts its whole limit.
  const blind = new MemoryStore();
  await store
    .query("organizations/o/runs")
    .then((documents) =>
      blind.write(documents.map(({ path, fields }) => ({ op: "set", path, fields }))),
    );
  const limited = await open(blind);
  assert.equal(limited.runtime.outputs["task-spent"], "1.5000");
  assert.equal(limited.runtime.outputs["month-spent"], "2.5000", "both reservations count");
  assert.equal(limited.runtime.outputs["key-limit"], "0.50");

  const accounts = new FakeAccounts();
  accounts.costs = { "100": 0.3 };
  const refreshed = await open(store, { accounts });
  assert.equal(refreshed.runtime.outputs["task-spent"], "0.3000");
  assert.equal(refreshed.runtime.outputs["key-limit"], "1.70");
  const cancelled = await run(store, "100-1-7");
  assert.deepEqual([cancelled?.status, cancelled?.cost], ["expired", 0.3]);
  assert.equal((await run(store, "290-1-8"))?.status, "open", "an open run is not refreshed");
});

test("a run whose provider fails to open ends its reservation, at no cost", async () => {
  const store = new MemoryStore();
  await seedRuns(store, { "300-1-7": {} });
  const inference = new FakeInference();
  inference.failure = new Error("Runpod POST /pods failed with 500.");
  await assert.rejects(open(store, { inference }), /failed with 500/);
  const failed = await run(store, "300-1-7");
  assert.deepEqual(
    [failed?.status, failed?.cost, failed?.reason],
    ["failed", 0, "Runpod POST /pods failed with 500."],
  );
  assert.ok(await store.get("organizations/o/events/300-1-7-key-failed"));
});

test("a failed open records what its provider did with pods, with the reasons it terminated them", async () => {
  const store = new MemoryStore();
  await seedRuns(store, { "300-1-7": {} });
  const inference = new FakeInference();
  inference.failure = new OpenFailure(new Error("Pod pod1 was not ready within 25 minutes."), [
    { pod: "pod1", event: "created" },
    { pod: "pod1", event: "terminated", reason: "it did not serve m" },
  ]);
  await assert.rejects(open(store, { inference }), /not ready within 25 minutes/);
  assert.ok(await store.get("organizations/o/events/300-1-7-pod-created-pod1"));
  const terminated = await store.get("organizations/o/events/300-1-7-pod-terminated-pod1");
  assert.equal(terminated?.fields.reason, "it did not serve m");
});

test("a task that started before the ledger carries what its record counted", async () => {
  const store = new MemoryStore();
  // A run the ledger has, which the record also counted.
  await seedRuns(store, { "200-1-7": { status: "closed", cost: 0.2 }, "300-1-7": {} });
  const choice = JSON.stringify({
    provider: "openrouter",
    accounts: ["openrouter"],
    recorded: { spent: 1.5 },
  });
  const first = await open(store, { inputs: openInputs({ inference: choice }) });
  assert.equal(first.runtime.outputs["task-spent"], "1.5000");
  assert.equal((await run(store, "300-1-7"))?.carried, 1.3);
  assert.equal(first.runtime.outputs["month-spent"], "0.2000", "the month counts the ledger's");
});

test("a provider without its secret opens nothing, and says which", async () => {
  const store = new MemoryStore();
  await seedRuns(store, { "300-1-7": {} });
  const accounts = new FakeAccounts();
  accounts.secrets.runpod = "CODEMAN_RUNPOD_API_KEY";
  const choice = JSON.stringify({
    provider: "openrouter",
    profile: "plan-or",
    accounts: ["openrouter", "runpod"],
    recorded: { spent: 0 },
  });
  // Runpod's account counts only in the organization's month.
  const alone = await open(store, { accounts, inputs: openInputs({ inference: choice }) });
  assert.equal(alone.runtime.outputs.status, "opened");

  const runs = new MemoryStore();
  await seedRuns(runs, { "300-1-7": {} });
  const { runtime, inference } = await open(runs, {
    accounts,
    inputs: openInputs({ inference: choice, "organization-monthly-budget": "50" }),
  });
  assert.equal(runtime.outputs.status, "missing-credentials");
  assert.match(runtime.outputs.reason ?? "", /`CODEMAN_RUNPOD_API_KEY`/);
  assert.ok(runtime.logged("info").includes("The run uses the profile `plan-or`."));
  assert.equal(inference.opened.length, 0);
  assert.equal((await run(runs, "300-1-7"))?.status, "refused");
});

test("closes the run by its handle, and reports what it used and the task's spend from the ledger", async () => {
  const store = new MemoryStore();
  await seedRuns(store, {
    "100-1-7": { status: "closed", cost: 0.08 },
    "300-1-7": { status: "open", limit: 1.9, reservedAt: new Date() },
  });
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
  await closeKey(fakeServices(new FakePlatform(), runtime, undefined, inference, undefined, store));
  assert.deepEqual(inference.closed, ["h"]);
  assert.deepEqual(runtime.outputs, {
    "run-cost": "0.0312",
    "input-tokens": "1500",
    "output-tokens": "40",
    requests: "3",
    "max-input-tokens": "900",
    "tokens-per-second": "48.3",
    "task-total": "0.1312",
    "task-costs": '{"100":0.1,"300":0.0312}',
  });
  assert.equal((await run(store, "100-1-7"))?.cost, 0.1, "OpenRouter's keys refresh it");
  assert.equal((await run(store, "300-1-7"))?.status, "closed");
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
