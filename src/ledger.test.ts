import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Ledger, ledgerRuns, type PickedRun } from "./ledger.ts";
import { closeKey, openKey } from "./steps/keys.ts";
import { select } from "./steps/select.ts";
import { MemoryStore } from "./store/memory.ts";
import type { Fields, Store, Write } from "./store/store.ts";
import { FakeInference } from "./testing/fake-inference.ts";
import { FakePlatform, fakeServices } from "./testing/fake-platform.ts";
import { FakeRuntime } from "./testing/fake-runtime.ts";
import { closeOnEndpoint, minutes, NOON, seedRuns, serverlessRun } from "./testing/ledger-runs.ts";

const workdir = mkdtempSync(join(tmpdir(), "codeman-ledger-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

const picked: PickedRun = {
  action: "implement",
  stage: "code",
  agent: true,
  model: "qwen3-coder:30b",
  provider: "runpod-pod",
  profile: "small-pod",
};

function ledger(store: Store, job: string, options: { attempt?: number; at?: string } = {}) {
  const runtime = new FakeRuntime({
    repository: { owner: "Codenergy", name: "Codeman" },
    runId: "300",
    attempt: options.attempt ?? 1,
  });
  const at = new Date(options.at ?? "2026-10-07T12:00:00Z");
  return {
    runtime,
    ledger: new Ledger(store, { runtime, job }, { now: () => at, wait: async () => undefined }),
  };
}

/** Every document of the organization's runs and events, by path. */
async function documents(store: Store, owner = "codenergy"): Promise<Record<string, Fields>> {
  const found = [
    ...(await store.query(`organizations/${owner}/runs`)),
    ...(await store.query(`organizations/${owner}/events`)),
  ];
  return Object.fromEntries(found.map((document) => [document.path, document.fields]));
}

test("a run's document grows with each job, and each job says what it did", async () => {
  const store = new MemoryStore();
  const pick = ledger(store, "select");
  pick.ledger.pick("300-1-7", picked);
  pick.ledger.pick("300-1-8", { ...picked, action: "record", stage: "", agent: false });
  await pick.ledger.flush(pick.runtime);
  const open = ledger(store, "open-key", { at: "2026-10-07T12:01:00Z" });
  const reserved = await open.ledger.reserve("300-1-7", {
    task: 7,
    taskBudget: 1.75,
    monthlyBudget: 20,
    recorded: 0,
    billed: new Map(),
  });
  assert.deepEqual(reserved, {
    outcome: "reserved",
    limit: 1.75,
    task: 0,
    month: 0,
    reserved: { amount: 0, runs: 0 },
    organization: undefined,
  });
  open.ledger.open("300-1-7", 1.75, [{ pod: "pod1", event: "created" }]);
  await open.ledger.flush(open.runtime);
  const close = ledger(store, "close-key", { at: "2026-10-07T12:31:00Z" });
  close.ledger.close(
    "300-1-7",
    { cost: 0.36, inputTokens: 3000, outputTokens: 120, requests: 2, pod: "pod1", pods: [] },
    "failure",
  );
  await close.ledger.flush(close.runtime);
  assert.deepEqual(close.runtime.logged("info"), ["Recorded 3 document(s) in Codeman's ledger."]);

  const event = (run: string, type: string, job: string, at: string, fields: Fields) => ({
    type,
    repository: "codenergy/codeman",
    task: Number(run.split("-")[2]),
    run,
    workflowRun: "300",
    attempt: 1,
    job,
    at: new Date(at),
    ...fields,
  });
  assert.deepEqual(await documents(store), {
    "organizations/codenergy/runs/300-1-7": {
      repository: "codenergy/codeman",
      task: 7,
      workflowRun: "300",
      attempt: 1,
      month: "2026-10",
      status: "closed",
      pickedAt: new Date("2026-10-07T12:00:00Z"),
      stage: "code",
      model: "qwen3-coder:30b",
      provider: "runpod-pod",
      profile: "small-pod",
      reservedAt: new Date("2026-10-07T12:01:00Z"),
      expiresAt: new Date("2026-10-07T14:01:00Z"),
      limit: 1.75,
      carried: 0,
      openedAt: new Date("2026-10-07T12:01:00Z"),
      closedAt: new Date("2026-10-07T12:31:00Z"),
      cost: 0.36,
      inputTokens: 3000,
      outputTokens: 120,
      requests: 2,
      pod: "pod1",
    },
    "organizations/codenergy/events/300-1-7-task-picked": event(
      "300-1-7",
      "task-picked",
      "select",
      "2026-10-07T12:00:00Z",
      { action: "implement", stage: "code" },
    ),
    "organizations/codenergy/events/300-1-8-task-picked": event(
      "300-1-8",
      "task-picked",
      "select",
      "2026-10-07T12:00:00Z",
      { action: "record", stage: "" },
    ),
    "organizations/codenergy/events/300-1-7-key-opened": event(
      "300-1-7",
      "key-opened",
      "open-key",
      "2026-10-07T12:01:00Z",
      { limit: 1.75 },
    ),
    "organizations/codenergy/events/300-1-7-pod-created-pod1": event(
      "300-1-7",
      "pod-created",
      "open-key",
      "2026-10-07T12:01:00Z",
      { pod: "pod1" },
    ),
    "organizations/codenergy/events/300-1-7-run-stopped": event(
      "300-1-7",
      "run-stopped",
      "close-key",
      "2026-10-07T12:31:00Z",
      { result: "failure" },
    ),
    "organizations/codenergy/events/300-1-7-run-closed": event(
      "300-1-7",
      "run-closed",
      "close-key",
      "2026-10-07T12:31:00Z",
      { cost: 0.36 },
    ),
  });
});

test("a terminated pod's time that no task counted counts in the organization's month, not a repository's", async () => {
  const store = new MemoryStore();
  const on = { provider: "runpod", mode: "pod", status: "closed", pod: "pod1" };
  await seedRuns(
    store,
    {
      "290-1-7": { ...on, repository: "codenergy/codeman", cost: 0.05, podCost: 0.06 },
      "290-1-8": { ...on, repository: "codenergy/codeman", cost: 0.15, podCost: 0.18 },
      "295-1-3": { ...on, repository: "codenergy/other", cost: 0.03, podCost: 0.03 },
      "300-1-9": { provider: "runpod", mode: "pod", repository: "codenergy/codeman" },
    },
    "codenergy",
    new Date("2026-10-07T12:00:00Z"),
  );
  const release = ledger(store, "release-pod", { at: "2026-10-07T12:30:00Z" });
  // Half an hour at US$ 0.72 per hour: US$ 0.36, of which the tasks counted US$ 0.27.
  release.ledger.release("290-1-8", [
    {
      pod: "pod1",
      event: "terminated",
      reason: "no run uses it and no task keeps it",
      life: {
        record: "n1",
        provider: "runpod",
        from: Date.parse("2026-10-07T12:00:00Z"),
        to: Date.parse("2026-10-07T12:30:00Z"),
        pricePerSecond: 0.0002,
      },
    },
  ]);
  await release.ledger.flush(release.runtime);
  const pod = (await store.get("organizations/codenergy/pods/n1"))?.fields;
  assert.deepEqual(
    [pod?.pod, pod?.provider, pod?.month, pod?.lifeCost, pod?.counted, pod?.untracked],
    ["pod1", "runpod", "2026-10", 0.36, 0.27, 0.09],
  );
  assert.equal(
    (await store.get("organizations/codenergy/events/290-1-8-pod-terminated-pod1"))?.fields.reason,
    "no run uses it and no task keeps it",
  );
  assert.match(
    release.runtime.logged("info").join("\n"),
    /the organization's month counts the other US\$ 0\.09/,
  );

  const open = ledger(store, "open-key", { at: "2026-10-07T13:00:00Z" });
  const budgets = { task: 9, taskBudget: 1, monthlyBudget: 20, recorded: 0, billed: new Map() };
  const repository = await open.ledger.reserve("300-1-9", budgets);
  assert.ok(Math.abs(repository.month - 0.24) < 1e-9, `${repository.month}`);
  const organization = await open.ledger.reserve("300-1-9", {
    ...budgets,
    organizationBudget: 100,
  });
  assert.ok(
    Math.abs((organization.organization ?? 0) - 0.36) < 1e-9,
    `${organization.organization}`,
  );
  assert.ok(Math.abs(organization.month - 0.24) < 1e-9);
  assert.ok((await open.ledger.monthRuns(open.runtime)).some((run) => run.id === "pod-n1"));
});

/** A run's cost in the ledger of the organization `codenergy`. */
async function costOf(store: Store, run: string): Promise<unknown> {
  return (await store.get(`organizations/codenergy/runs/${run}`))?.fields.cost;
}

test("Serverless runs of two repositories split the time they shared the endpoint's worker, as each closes", async () => {
  const store = new MemoryStore();
  await seedRuns(
    store,
    {
      "300-1-7": serverlessRun("codeman", NOON - 60_000),
      "310-1-4": serverlessRun("other", NOON + 4 * 60_000),
      // Still open: it counts its limit, whatever the others' closes do.
      "320-1-9": serverlessRun("codeman", NOON + 8 * 60_000),
      "330-1-11": { repository: "codenergy/codeman" },
      "340-1-12": { repository: "codenergy/codeman" },
    },
    "codenergy",
    new Date(NOON),
  );
  const months = async (run: string, at: number) => {
    const open = new Ledger(
      store,
      {
        runtime: new FakeRuntime({ repository: { owner: "Codenergy", name: "Codeman" } }),
        job: "open-key",
      },
      { now: () => new Date(at) },
    );
    const reservation = await open.reserve(run, {
      task: Number(run.split("-")[2]),
      taskBudget: 1,
      monthlyBudget: 20,
      organizationBudget: 100,
      recorded: 0,
      billed: new Map(),
    });
    return [reservation.month, reservation.organization].map((amount) => amount?.toFixed(4));
  };

  // The first run closes alone so far: it counts its whole estimate, 10 minutes at US$ 0.06.
  const first = await closeOnEndpoint(
    store,
    "300-1-7",
    "codeman",
    [minutes(0, 10)],
    NOON + 11 * 60_000,
  );
  assert.equal(await costOf(store, "300-1-7"), 0.6);
  assert.match(first.logged("info").join("\n"), /no other run used it at the same time so far/);
  // The repository's month: its closed run and its open one; the organization's adds the other's.
  assert.deepEqual(await months("330-1-11", NOON + 12 * 60_000), ["1.6000", "2.6000"]);

  // The other repository's run used the worker from 5 to 15 minutes: they shared 5 minutes.
  const second = await closeOnEndpoint(
    store,
    "310-1-4",
    "other",
    [minutes(5, 15)],
    NOON + 16 * 60_000,
  );
  assert.equal(await costOf(store, "310-1-4"), 0.45);
  assert.equal(await costOf(store, "300-1-7"), 0.45, "the earlier close counts less now");
  assert.match(
    second.logged("info").join("\n"),
    /shared endpoint ep1's worker with 1 other run\(s\) of the organization: it counts US\$ 0\.45 of its US\$ 0\.60 estimate, and 1 other run\(s\) count less now/,
  );
  assert.equal((await store.get("organizations/codenergy/runs/310-1-4"))?.fields.endpoint, "ep1");
  // The costs add up to the worker's 15 minutes; the open runs, and the one reserved above, still
  // count their limits.
  assert.deepEqual(await months("340-1-12", NOON + 17 * 60_000), ["2.4500", "2.9000"]);
  assert.equal(await costOf(store, "320-1-9"), undefined);

  const endpoint = await store.query("organizations/codenergy/endpoints/ep1/runs");
  assert.deepEqual(
    endpoint.map(({ path, fields }) => [
      path.split("/").at(-1),
      fields.repository,
      fields.estimate,
      fields.share,
    ]),
    [
      [`300-1-7-${NOON - 60_000}`, "codenergy/codeman", 0.6, 0.45],
      [`310-1-4-${NOON + 4 * 60_000}`, "codenergy/other", 0.6, 0.45],
    ],
  );
  assert.equal(endpoint[0]?.fields.busy, JSON.stringify([minutes(0, 10)]));

  // A re-run of the second close-key writes the same documents, and the same costs.
  const again = await closeOnEndpoint(
    store,
    "310-1-4",
    "other",
    [minutes(5, 15)],
    NOON + 20 * 60_000,
  );
  assert.equal((await store.query("organizations/codenergy/endpoints/ep1/runs")).length, 2);
  assert.equal(await costOf(store, "310-1-4"), 0.45);
  assert.equal(await costOf(store, "300-1-7"), 0.45);
  assert.match(again.logged("info").join("\n"), /and 0 other run\(s\) count less now/);
});

test("a run that open-key opened again keeps its earlier attempt's time in the split, and an open run its limit", async () => {
  const store = new MemoryStore();
  await seedRuns(
    store,
    {
      "300-1-7": serverlessRun("codeman", NOON - 60_000),
      "310-1-4": serverlessRun("other", NOON + 4 * 60_000),
    },
    "codenergy",
    new Date(NOON),
  );
  await closeOnEndpoint(store, "300-1-7", "codeman", [minutes(0, 10)], NOON + 11 * 60_000);
  // A re-run of its open-key reserves again: what it spent becomes spentBefore.
  const reopen = ledger(store, "open-key", { at: new Date(NOON + 12 * 60_000).toISOString() });
  await reopen.ledger.reserve("300-1-7", {
    task: 7,
    taskBudget: 2,
    monthlyBudget: 20,
    recorded: 0,
    billed: new Map(),
  });
  await closeOnEndpoint(store, "310-1-4", "other", [minutes(5, 15)], NOON + 16 * 60_000);
  assert.equal(await costOf(store, "310-1-4"), 0.45, "the earlier attempt shared the worker");
  const reopened = (await store.get("organizations/codenergy/runs/300-1-7"))?.fields;
  assert.deepEqual(
    [reopened?.status, reopened?.cost, reopened?.limit, reopened?.spentBefore],
    ["open", null, 1.4, 0.6],
    "an open run keeps its reservation",
  );
  // Its second attempt closes alone, beside the first's time.
  await closeOnEndpoint(store, "300-1-7", "codeman", [minutes(20, 25)], NOON + 26 * 60_000);
  assert.equal(await costOf(store, "300-1-7"), 0.3);
  assert.equal((await store.query("organizations/codenergy/endpoints/ep1/runs")).length, 3);
  assert.equal(await costOf(store, "310-1-4"), 0.45);
});

test("close-key reports a Serverless run's share, and the other task's next close-key its own", async () => {
  const store = new MemoryStore();
  await seedRuns(
    store,
    {
      "300-1-7": serverlessRun("codeman", NOON - 60_000),
      "310-1-4": serverlessRun("other", NOON + 4 * 60_000),
      "350-1-7": {
        repository: "codenergy/codeman",
        status: "open",
        limit: 1,
        reservedAt: new Date(NOON),
      },
    },
    "codenergy",
    new Date(NOON),
  );
  await closeOnEndpoint(store, "300-1-7", "codeman", [minutes(0, 10)], NOON + 11 * 60_000);
  const closeKeyOf = async (name: string, run: string, inference: FakeInference) => {
    const runtime = new FakeRuntime({
      inputs: { handle: "h", "ledger-run": run },
      repository: { owner: "Codenergy", name },
      runId: run.split("-")[0],
    });
    await closeKey(
      fakeServices(new FakePlatform(), runtime, undefined, inference, undefined, store),
    );
    return runtime.outputs;
  };
  const busy = { endpoint: "ep1", pricePerSecond: 0.001, spans: [minutes(5, 15)] };
  const other = await closeKeyOf(
    "other",
    "310-1-4",
    new FakeInference({ usage: { cost: 0.6, busy } }),
  );
  assert.equal(other["run-cost"], "0.6000", "the gateway's estimate");
  assert.equal(other["task-costs"], '{"310":0.45}');
  assert.equal(other["task-total"], "0.4500");
  // The first task's spend table gets its run's share at its next run's apply.
  const next = await closeKeyOf("codeman", "350-1-7", new FakeInference({ usage: { cost: 0.1 } }));
  assert.equal(next["task-costs"], '{"300":0.45,"350":0.1}');
  assert.equal(next["task-total"], "0.5500");
});

test("a refused run says why, in its document and its event", async () => {
  const store = new MemoryStore();
  const { ledger: open, runtime } = ledger(store, "open-key");
  open.refuse("300-1-7", "over-budget", "The monthly budget is reached.");
  await open.flush(runtime);
  const run = await store.get("organizations/codenergy/runs/300-1-7");
  assert.deepEqual(run?.fields, {
    status: "refused",
    refusedAt: new Date("2026-10-07T12:00:00Z"),
    refusal: "over-budget",
    reason: "The monthly budget is reached.",
  });
  const refused = await store.get("organizations/codenergy/events/300-1-7-key-refused");
  assert.equal(refused?.fields.status, "over-budget");
});

test("a write that fails is tried again, and one that still fails fails the job, saying why", async () => {
  const store = new MemoryStore();
  let failures = 2;
  const flaky: Store = {
    get: (path) => store.get(path),
    query: (path, query) => store.query(path, query),
    transaction: (work, options) => store.transaction(work, options),
    write: async (writes: readonly Write[]) => {
      if (failures-- > 0) throw new Error("Firestore commit failed with 503 UNAVAILABLE.");
      await store.write(writes);
    },
  };
  const waits: number[] = [];
  const runtime = new FakeRuntime({ repository: { owner: "o", name: "r" } });
  const flakyLedger = new Ledger(
    flaky,
    { runtime, job: "close-key" },
    {
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  );
  flakyLedger.close("1-1-7", { cost: 0.1 }, "success");
  await flakyLedger.flush(runtime);
  assert.deepEqual(waits, [1000, 3000]);
  assert.deepEqual(runtime.logged("warning"), [
    "Could not write to Codeman's ledger (Firestore commit failed with 503 UNAVAILABLE.); trying again in 1 s.",
    "Could not write to Codeman's ledger (Firestore commit failed with 503 UNAVAILABLE.); trying again in 3 s.",
  ]);
  assert.equal((await store.get("organizations/o/runs/1-1-7"))?.fields.cost, 0.1);

  failures = 10;
  const again = new Ledger(flaky, { runtime, job: "close-key" }, { wait: async () => undefined });
  again.close("1-1-7", { cost: 0.2 }, "success");
  await assert.rejects(
    again.flush(runtime),
    /^Error: Could not write to Codeman's ledger after 4 attempts: Firestore commit failed with 503/,
  );
});

test("a task's run from select to close-key, and a re-run of its key jobs, write the same documents", async () => {
  const store = new MemoryStore();
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  platform.maintainers.add("alice");
  platform.openIssue("alice", "Add a cache", "Cache responses.");
  const selected = new FakeRuntime({ inputs: { workdir }, runId: "300" });
  await select(fakeServices(platform, selected, undefined, undefined, undefined, store));
  const [task] = JSON.parse(selected.outputs.tasks ?? "") as Record<string, string>[];
  assert.equal(task?.["ledger-run"], "300-1-1");

  const keyJobs = async (attempt: number) => {
    const inference = new FakeInference({ usage: { cost: 0.05, inputTokens: 900 } });
    const open = new FakeRuntime({
      inputs: {
        "encryption-secret": "s".repeat(32),
        task: "1",
        "task-budget": "2",
        "monthly-budget": "20",
        "ledger-run": task?.["ledger-run"] ?? "",
      },
      runId: "300",
      attempt,
    });
    await openKey(fakeServices(platform, open, undefined, inference, undefined, store));
    const close = new FakeRuntime({
      inputs: { handle: "handle-300", "ledger-run": task?.["ledger-run"] ?? "" },
      runId: "300",
      attempt,
    });
    await closeKey(fakeServices(platform, close, undefined, inference, undefined, store));
  };
  await keyJobs(1);
  const first = await documents(store, "o");
  assert.deepEqual(Object.keys(first).sort(), [
    "organizations/o/events/300-1-1-key-opened",
    "organizations/o/events/300-1-1-run-closed",
    "organizations/o/events/300-1-1-task-picked",
    "organizations/o/runs/300-1-1",
  ]);
  const run = first["organizations/o/runs/300-1-1"];
  assert.equal(run?.status, "closed");
  assert.equal(run?.stage, "plan");
  assert.equal(run?.model, "a/b");
  assert.equal(run?.provider, "openrouter");
  assert.equal(run?.limit, 2);
  assert.equal(run?.cost, 0.05);
  assert.equal(run?.inputTokens, 900);
  assert.equal(run?.outputTokens, undefined, "unknown figures are left out");

  // A re-run of the key jobs is the workflow run's next attempt, of the same run.
  await keyJobs(2);
  const second = await documents(store, "o");
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  assert.equal(second["organizations/o/runs/300-1-1"]?.attempt, 1, "the attempt that picked it");
  assert.equal(second["organizations/o/events/300-1-1-key-opened"]?.attempt, 2);
});

test("runs picked before providers read with their account, as new ones do", () => {
  const document = (id: string, fields: Fields) => ({
    path: `organizations/o/runs/${id}`,
    version: "1",
    fields: {
      repository: "o/r",
      task: 7,
      pickedAt: new Date("2026-10-07T12:00:00Z"),
      ...fields,
    },
  });
  const runs = ledgerRuns([
    document("100-1-7", { provider: "runpod", mode: "pod" }),
    document("101-1-7", { provider: "openrouter", mode: "openrouter" }),
    document("102-1-7", { provider: "runpod", mode: "serverless" }),
    document("103-1-7", { provider: "runpod-pod" }),
    document("104-1-7", { provider: "runpod-serverless" }),
    document("105-1-7", { provider: "openrouter" }),
  ]);
  assert.deepEqual(
    runs.map((run) => [run.id, run.account]),
    [
      ["100-1-7", "runpod"],
      ["101-1-7", "openrouter"],
      ["102-1-7", "runpod"],
      ["103-1-7", "runpod"],
      ["104-1-7", "runpod"],
      ["105-1-7", "openrouter"],
    ],
  );
});
