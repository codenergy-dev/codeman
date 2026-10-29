import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, test } from "node:test";
import { GATEWAY_VERSION, sha256 } from "../gateway/gateway.ts";
import type { FitReport } from "../gateway/pod.ts";
import { closeKey, openKey } from "../steps/keys.ts";
import { LAYOUT } from "../store/layout.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeGateways, FakeGpu } from "../testing/fake-gpu.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { seedRuns } from "../testing/ledger-runs.ts";
import type { PodSpec } from "./gpu.ts";
import type { ModelHub } from "./huggingface.ts";
import { IMAGES_BEFORE_SALAD, POD_IMAGES } from "./images.ts";
import { IMAGES_WITHOUT_OLLAMA_SETTINGS, ollama, SINGLE_RUN_IMAGES } from "./ollama.ts";
import { ConcurrencyReached, OpenFailure } from "./provider.ts";
import { CREATE_LEASE_MS, PodRegistry } from "./registry.ts";
import {
  accountFingerprint,
  adminToken,
  END_ATTEMPTS,
  END_RETRY_MS,
  fitKey,
  ofOrganization,
  type PodHandle,
  PodInference,
  type PodSettings,
  podCapacity,
  podSettingsKey,
  podVllm,
  releasePod,
  vllmDiskGb,
} from "./selfhosted.ts";
import { vllm } from "./vllm.ts";

const repository = { owner: "o", name: "r" };
/** The image pinned before shared pods: each task gets a pod of its own. */
const [ONE_RUN_IMAGE = ""] = [...SINGLE_RUN_IMAGES];
const settings: PodSettings = {
  model: "qwen3-coder:30b",
  engine: ollama,
  pods: [],
  gpuType: "GPU-A",
  image: ONE_RUN_IMAGE,
  reuse: "task",
};
/** An image built since shared pods: its gateway serves several runs. */
const SHARED_IMAGE = "ghcr.io/o/codeman-pod@sha256:1";
const noWait = async () => undefined;
const near = (actual: number | undefined, expected: number) =>
  assert.ok(Math.abs((actual ?? Number.NaN) - expected) < 1e-9, `${actual} is not ${expected}`);

/**
 * Pods on a fake GPU cloud, with the pod registry in memory. By default each pod's gateway answers
 * as one that serves one run at a time; with `real`, Codeman's own gateway answers.
 */
function setup(
  options: { real?: boolean; image?: string; hub?: ModelHub; noBilling?: boolean } = {},
) {
  let now = new Date("2026-10-03T12:00:00Z");
  const gpu = new FakeGpu({ now: () => now, noBilling: options.noBilling === true });
  const gateways = new FakeGateways(gpu, { real: options.real === true });
  after(() => gateways.close());
  const store = new MemoryStore();
  let wait: (ms: number) => Promise<void> = noWait;
  const make = (more: Partial<PodSettings> = {}, of = repository) =>
    new PodInference(
      { ...settings, ...(options.image ? { image: options.image } : {}), ...more },
      {
        repository: of,
        gpu,
        account: { key: "account-key" },
        store,
        now: () => now,
        fetch: gateways.fetch,
        wait: (ms) => wait(ms),
        ...(options.hub ? { hub: options.hub } : {}),
      },
    );
  const open = async (
    task: string,
    runId: string,
    more: Partial<PodSettings> = {},
    of = repository,
    limit = 1,
  ) => {
    const provider = make(more, of);
    const runtime = new FakeRuntime();
    const opened = await provider.open(
      { task, runId, limit, reservationMs: 2 * 3_600_000 },
      runtime,
    );
    return { provider, opened, handle: JSON.parse(opened.handle) as PodHandle, runtime };
  };
  const registry = new PodRegistry(store, "o", () => now);
  const release = (handle: string, runtime = new FakeRuntime()) =>
    releasePod(gpu.pods, registry, handle, runtime, {
      provider: gpu.name,
      now: () => now,
      gateway: { accountKey: "account-key", fetch: gateways.fetch },
    });
  return {
    gpu,
    gateways,
    store,
    registry,
    make,
    open,
    release,
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    setWait: (next: (ms: number) => Promise<void>) => {
      wait = next;
    },
  };
}

test("a run creates a pod for its settings, held in the registry, and gives the agent a token for its gateway", async () => {
  const { gpu, gateways, registry, open } = setup();
  const { opened, handle } = await open("7", "300", {}, repository, 1.5);
  const spec = gpu.created[0];
  assert.equal(spec?.gpuType, "GPU-A");
  assert.equal(spec?.image, ONE_RUN_IMAGE);
  assert.equal(spec?.port, 8080);
  assert.equal(spec?.env.CODEMAN_ORGANIZATION, "o");
  assert.equal(spec?.env.CODEMAN_POD_SETTINGS, podSettingsKey(settings, "o/r#7"));
  assert.equal(spec?.env.CODEMAN_MODEL, "qwen3-coder:30b");
  assert.equal(spec?.env.CODEMAN_START_BY, "2026-10-03T12:25:00.000Z");
  for (const name of ["CODEMAN_REPOSITORY", "CODEMAN_TASK", "CODEMAN_RUN", "CODEMAN_GROUP"]) {
    assert.equal(spec?.env[name], undefined, name);
  }
  const nonce = spec?.env.CODEMAN_NONCE ?? "";
  assert.equal(spec?.env.CODEMAN_ADMIN_SHA256, sha256(adminToken("account-key", nonce)));
  assert.ok(!JSON.stringify(spec?.env).includes("account-key"));

  assert.equal(handle.podId, "pod1");
  assert.equal(handle.nonce, nonce);
  assert.equal(handle.holder, "o/r#7");
  assert.equal(handle.shared, undefined, "the image serves one run at a time");
  assert.equal(handle.start, Date.parse("2026-10-03T12:00:00Z"), "billing starts with the pod");
  assert.equal(opened.baseUrl, "https://pod1-8080.pods.test/v1");
  assert.equal(opened.contextLength, 65536);
  assert.deepEqual(opened.pods, [{ pod: "pod1", event: "created" }]);
  const run = gateways.state("pod1").run;
  assert.equal(run?.tokenSha256, sha256(opened.credential));
  assert.equal(run?.limit, 1.5);
  assert.equal(run?.pricePerSecond, 0.0002);
  assert.equal(run?.task, undefined);
  assert.ok(!opened.handle.includes(opened.credential));

  const [record] = await registry.live();
  assert.equal(record?.nonce, nonce);
  assert.equal(record?.status, "serving");
  assert.equal(record?.pod, "pod1");
  assert.deepEqual(
    record?.leases.map((lease) => [lease.holder, lease.kind, lease.run]),
    [["o/r#7", "run", "300"]],
  );
});

test("close reads the run's usage, costs its time, and keeps the pod for the task; a release terminates it", async () => {
  const { gpu, registry, open, advance, release } = setup();
  const { provider, opened } = await open("7", "300", {}, repository, 1.5);
  advance(30 * 60_000);
  gpu.billed.pod1 = 0.3;
  const usage = await provider.close(opened.handle, new FakeRuntime());
  assert.ok(Math.abs(usage.cost - 0.36) < 1e-9, "half an hour at US$ 0.72 per hour");
  assert.equal(usage.inputTokens, 3000);
  assert.equal(usage.requests, 2);
  assert.equal(usage.pod, "pod1");
  assert.equal(usage.keptPod, "pod1");
  assert.deepEqual(usage.podCosts, { pod1: 0.36 }, "its life so far, above its late billing");
  assert.ok(gpu.live.has("pod1"));
  assert.deepEqual(usage.pods, []);
  const [kept] = await registry.live();
  assert.deepEqual(
    kept?.leases.map((lease) => [lease.holder, lease.kind, lease.until.toISOString()]),
    [["o/r#7", "keep", "2026-10-03T12:45:00.000Z"]],
  );

  advance(60_000);
  const runtime = new FakeRuntime();
  const pods = await release(opened.handle, runtime);
  assert.deepEqual(pods, [
    {
      pod: "pod1",
      event: "terminated",
      reason: "the task does not go on to another run now, and no other task uses or keeps it",
      life: {
        record: kept?.nonce,
        provider: "fake",
        from: Date.parse("2026-10-03T12:00:00Z"),
        to: Date.parse("2026-10-03T12:31:00Z"),
        pricePerSecond: 0.0002,
      },
    },
  ]);
  assert.deepEqual(gpu.terminated, ["pod1"]);
  assert.deepEqual(await registry.live(), []);
});

test("the task's next run reuses its kept pod, with a new token and its own start", async () => {
  const { gpu, gateways, open, advance } = setup();
  const first = await open("7", "300", {}, repository, 1.5);
  advance(10 * 60_000);
  await first.provider.close(first.opened.handle, new FakeRuntime());
  advance(2 * 60_000);
  const second = await open("7", "301");
  assert.equal(gpu.created.length, 1, "no new pod");
  assert.deepEqual(second.opened.pods, [{ pod: "pod1", event: "joined" }]);
  assert.equal(second.handle.podId, "pod1");
  assert.equal(second.handle.start, Date.parse("2026-10-03T12:12:00Z"));
  assert.notEqual(second.opened.credential, first.opened.credential);
  assert.equal(gateways.state("pod1").run?.tokenSha256, sha256(second.opened.credential));
  assert.match(
    second.runtime.logged("info").join("\n"),
    /Reusing pod pod1, kept from the task's last run/,
  );
});

test("a model change ends the task's keep lease on its pod, which no other task holds", async () => {
  const { gpu, open } = setup();
  const first = await open("7", "300");
  await first.provider.close(first.opened.handle, new FakeRuntime());
  const other = await open("7", "301", { model: "llama3.2" });
  assert.deepEqual(gpu.terminated, ["pod1"]);
  assert.equal(other.handle.podId, "pod2");
  assert.deepEqual(
    other.opened.pods?.map(({ pod, event, reason }) => [pod, event, reason]),
    [
      ["pod1", "terminated", "the task that kept it runs on other settings now"],
      ["pod2", "created", undefined],
    ],
  );
});

test("with one pod per run, close terminates it", async () => {
  const { gpu, open } = setup();
  const { provider, opened } = await open("7", "300", { reuse: "run" });
  const usage = await provider.close(opened.handle, new FakeRuntime());
  assert.equal(usage.keptPod, undefined);
  assert.deepEqual(gpu.terminated, ["pod1"]);
  assert.deepEqual(
    usage.pods?.map(({ pod, event, reason }) => [pod, event, reason]),
    [["pod1", "terminated", "no run uses it and no task keeps it"]],
  );
});

test("a close whose pod does not answer still costs the run's time and terminates the pod", async () => {
  const { gpu, gateways, open, advance } = setup();
  const { provider, opened } = await open("7", "300");
  gateways.state("pod1").reachable = false;
  advance(5 * 60_000);
  const runtime = new FakeRuntime();
  const usage = await provider.close(opened.handle, runtime);
  assert.ok(Math.abs(usage.cost - 0.06) < 1e-9);
  assert.equal(usage.inputTokens, undefined);
  assert.equal(usage.keptPod, undefined);
  assert.deepEqual(gpu.terminated, ["pod1"]);
  assert.match(runtime.logged("warning")[0] ?? "", /Could not read the run's usage/);
});

test("a pod that never serves the model is terminated, and the failure says what was done with it", async () => {
  const { gpu, gateways, registry, open } = setup();
  gateways.state("pod1").ready = false;
  const failure = await open("7", "300").then(
    () => undefined,
    (error: unknown) => error,
  );
  assert.ok(failure instanceof OpenFailure);
  assert.match(failure.message, /not ready within 25 minutes/);
  assert.deepEqual(
    failure.pods.map(({ pod, event }) => [pod, event]),
    [
      ["pod1", "created"],
      ["pod1", "terminated"],
    ],
  );
  assert.equal(failure.pods[1]?.life?.from, Date.parse("2026-10-03T12:00:00Z"));
  assert.deepEqual(gpu.terminated, ["pod1"]);
  assert.deepEqual(await registry.live(), []);
});

test("a run that would pass the month's budget creates no pod", async () => {
  const { gpu, gateways, store, make } = setup();
  await seedRuns(store, {
    "100-1-7": { status: "closed", cost: 0.5, provider: "runpod", mode: "pod", month: "2000-01" },
    "200-1-8": { status: "closed", cost: 18.6, provider: "runpod", mode: "pod" },
    "300-1-7": { provider: "runpod", mode: "pod" },
  });
  const runtime = new FakeRuntime({
    inputs: {
      "encryption-secret": "s".repeat(32),
      task: "7",
      "task-budget": "2",
      "monthly-budget": "20",
      "ledger-run": "300-1-7",
      "agent-job-minutes": "60",
    },
  });
  await openKey(fakeServices(new FakePlatform(), runtime, undefined, make(), undefined, store));
  assert.equal(runtime.outputs.status, "over-budget");
  assert.equal(runtime.outputs["task-spent"], "0.5000");
  assert.equal(gpu.created.length, 0);
  assert.equal(gateways.calls.length, 0);
});

test("close-key reports the pod and whether it was kept, and records its pods' costs", async () => {
  const { gpu, store, make } = setup();
  const runpod = { provider: "runpod", mode: "pod" };
  await seedRuns(store, {
    "200-1-7": { ...runpod, status: "closed", cost: 0.3, pod: "old", podCost: 0.3 },
    "300-1-7": { ...runpod, status: "open", limit: 1, reservedAt: new Date() },
  });
  const provider = make({ pods: ["old"] });
  const opened = await provider.open(
    { task: "7", runId: "300", limit: 1, reservationMs: 2 * 3_600_000 },
    new FakeRuntime(),
  );
  gpu.billed.old = 0.42;
  const runtime = new FakeRuntime({ inputs: { handle: opened.handle, "ledger-run": "300-1-7" } });
  await closeKey(fakeServices(new FakePlatform(), runtime, undefined, provider, undefined, store));
  assert.equal(runtime.outputs.pod, "pod1");
  assert.equal(runtime.outputs["kept-pod"], "pod1");
  assert.equal(runtime.outputs["input-tokens"], "3000");
  // The old pod's billing passed what the task counted for it: its kept time counts too.
  assert.equal((await store.get("organizations/o/runs/200-1-7"))?.fields.podCost, 0.42);
  assert.equal((await store.get("organizations/o/runs/300-1-7"))?.fields.podCost, 0);
  assert.equal(runtime.outputs["task-total"], "0.4200");
  assert.equal(runtime.outputs["task-costs"], '{"200":0.42,"300":0}');
});

test("a kept pod's time between runs counts in its cost, before Runpod bills it", async () => {
  const { open, advance } = setup();
  const first = await open("7", "300", {}, repository, 1.5);
  advance(10 * 60_000);
  await first.provider.close(first.opened.handle, new FakeRuntime());
  advance(2 * 60_000);
  const second = await open("7", "301", {}, repository, 1.1);
  assert.equal(second.handle.created, Date.parse("2026-10-03T12:00:00Z"));
  advance(5 * 60_000);
  const usage = await second.provider.close(second.opened.handle, new FakeRuntime());
  assert.ok(Math.abs(usage.cost - 0.06) < 1e-9, "the run: 5 minutes");
  assert.equal(usage.podCosts?.pod1, 0.204, "the pod: 17 minutes, 2 of them between runs");
});

test("without the provider's billing, as on Salad, a run costs its pod's time from its creation at the price of its priority", async () => {
  const { gpu, open, advance } = setup({ noBilling: true });
  gpu.priorityPrices.medium = { "GPU-A": 0.0001 };
  // What a billing would say, were it read.
  gpu.billed.pod1 = 9;
  const first = await open("7", "300", { priority: "medium" }, repository, 1.5);
  assert.equal(first.handle.pricePerSecond, 0.0001, "the listed price at its priority");
  assert.equal(first.handle.start, first.handle.created, "from the pod's creation");
  advance(10 * 60_000);
  const runtime = new FakeRuntime();
  const usage = await first.provider.close(first.opened.handle, runtime);
  near(usage.cost, 0.06);
  assert.deepEqual(usage.podCosts, { pod1: 0.06 }, "the pod's lifetime, no billing");
  assert.deepEqual(runtime.logged("warning"), [], "an estimate by design, not a failure");
  // The next run counts the kept pod's time between runs, still without billing.
  advance(2 * 60_000);
  const second = await open("7", "301", { priority: "medium" }, repository, 1.1);
  advance(5 * 60_000);
  const next = await second.provider.close(second.opened.handle, new FakeRuntime());
  near(next.cost, 0.03);
  assert.deepEqual(next.podCosts, { pod1: 0.102 }, "17 minutes of the pod");
});

test("without the provider's billing, runs on a shared pod each count their share of its time", async () => {
  const { gpu, open, advance } = setup({ real: true, image: SHARED_IMAGE, noBilling: true });
  gpu.billed.pod1 = 9;
  const a = await open("7", "300");
  const b = await open("8", "300");
  assert.equal(gpu.created.length, 1);
  advance(10 * 60_000);
  const first = await a.provider.close(a.opened.handle, new FakeRuntime());
  near(first.cost, 0.06);
  assert.deepEqual(first.podCosts, { pod1: 0.06 }, "its share, as the gateway measured it");
  assert.equal(first.podShared, true);
  advance(10 * 60_000);
  const second = await b.provider.close(b.opened.handle, new FakeRuntime());
  near(second.cost, 0.18);
  assert.deepEqual(second.podCosts, { pod1: 0.18 });
});

test("Codeman's environment for an organization: its own, or a repository's from before the registry", () => {
  assert.ok(ofOrganization({ env: { CODEMAN_ORGANIZATION: "o" } }, "O"));
  assert.ok(ofOrganization({ env: { CODEMAN_REPOSITORY: "O/r" } }, "o"));
  assert.ok(!ofOrganization({ env: { CODEMAN_REPOSITORY: "other/r" } }, "o"));
  assert.ok(!ofOrganization({ env: { CODEMAN_ORGANIZATION: "other" } }, "o"));
  assert.ok(!ofOrganization({ env: {} }, "o"));
  assert.ok(!ofOrganization({ env: { CODEMAN_REPOSITORY: "" } }, "o"));
});

test("open terminates the organization's pods that nothing holds, and never another pod", async () => {
  const { gpu, registry, open, now } = setup();
  const spec: PodSpec = {
    image: ONE_RUN_IMAGE,
    port: 8080,
    gpuType: "GPU-A",
    diskGb: 1,
    name: "n",
    env: {},
  };
  const create = (env: Record<string, string>) => gpu.pods.create({ ...spec, env });
  const description = {
    model: "m",
    gpuType: "GPU-A",
    image: ONE_RUN_IMAGE,
    reuse: "task",
    provider: "fake",
  };
  /** A pod the registry holds, with its creator's run lease. */
  const held = async (settings: string, holder: string) => {
    const claim = await registry.claim({ ...description, settings }, holder, "200", 2 * 3_600_000);
    assert.equal(claim.kind, "create");
    const pod = await create({ CODEMAN_ORGANIZATION: "o", CODEMAN_NONCE: claim.pod.nonce });
    await registry.register(claim.pod.nonce, {
      pod: pod.id,
      createdAt: pod.createdAt,
      pricePerSecond: 0.0002,
    });
    return { nonce: claim.pod.nonce, pod: pod.id };
  };
  // pod1: created before the registry, for a repository of the organization; pod2: Codeman's
  // environment, not in the registry; pod3: no Codeman environment; pod4 and pod5: another
  // organization's.
  await create({ CODEMAN_REPOSITORY: "O/r", CODEMAN_TASK: "7", CODEMAN_NONCE: "a" });
  await create({ CODEMAN_ORGANIZATION: "o", CODEMAN_NONCE: "b" });
  await create({ SOMETHING: "else" });
  await create({ CODEMAN_ORGANIZATION: "other", CODEMAN_NONCE: "c" });
  await create({ CODEMAN_REPOSITORY: "other/r", CODEMAN_NONCE: "d" });
  // pod6: held by a run of another repository's task; pod7: kept by a task; pod8: its leases
  // expired; pod9: gone from the provider; pod10: stopped.
  const run = await held("s6", "o/s#3");
  const kept = await held("s7", "o/s#4");
  await registry.leave(kept.nonce, "o/s#4", { keepUntil: new Date(now().getTime() + 60_000) });
  const expired = { nonce: "", pod: "pod8" };
  {
    const claim = await registry.claim(
      { ...description, settings: "s8" },
      "o/r#9",
      "100",
      2 * 3_600_000,
    );
    const pod = await create({ CODEMAN_ORGANIZATION: "o", CODEMAN_NONCE: claim.pod.nonce });
    await registry.register(claim.pod.nonce, {
      pod: pod.id,
      createdAt: pod.createdAt,
      pricePerSecond: 0.0002,
    });
    expired.nonce = claim.pod.nonce;
    await registry.change(claim.pod.nonce, (pod) => ({
      leases: pod.leases.map((lease) => ({ ...lease, until: new Date(now().getTime() - 1) })),
    }));
  }
  const gone = await held("s9", "o/r#10");
  gpu.live.delete(gone.pod);
  const stopped = await held("s10", "o/r#11");
  gpu.setStatus(stopped.pod, "stopped");
  // A task that holds the creation lease of other settings, and whose pod the provider just
  // created: it is held.
  const creating = await registry.claim(
    { ...description, settings: "s11" },
    "o/r#12",
    "300",
    2 * 3_600_000,
  );
  const fresh = await create({ CODEMAN_ORGANIZATION: "o", CODEMAN_NONCE: creating.pod.nonce });

  const { opened } = await open("13", "300");
  assert.deepEqual(gpu.terminated.sort(), ["pod1", "pod2", expired.pod, stopped.pod].sort());
  for (const id of ["pod3", "pod4", "pod5", kept.pod, run.pod, fresh.id]) {
    assert.ok(gpu.live.has(id), `${id} stays`);
  }
  const reasons = new Map(
    opened.pods?.filter((one) => one.event === "terminated").map((one) => [one.pod, one.reason]),
  );
  assert.equal(
    reasons.get("pod1"),
    "it carries Codeman's environment, and the pod registry does not hold it",
  );
  assert.equal(reasons.get("pod2"), reasons.get("pod1"));
  assert.equal(reasons.get(expired.pod), "its leases all expired");
  assert.equal(reasons.get(stopped.pod), "it stopped");
  assert.equal(reasons.size, 4);
  const live = new Set((await registry.live()).map((pod) => pod.nonce));
  assert.ok(live.has(run.nonce) && live.has(kept.nonce) && live.has(creating.pod.nonce));
  assert.ok(!live.has(expired.nonce) && !live.has(gone.nonce) && !live.has(stopped.nonce));
});

test("two tasks of a run share one pod: the first creates it, the other joins, and each pays its share", async () => {
  const { gpu, gateways, store, open, advance, release } = setup({
    real: true,
    image: SHARED_IMAGE,
  });
  const a = await open("7", "300");
  const b = await open("8", "300");
  assert.equal(gpu.created.length, 1);
  assert.equal(a.handle.podId, "pod1");
  assert.equal(b.handle.podId, "pod1");
  assert.deepEqual(a.handle.shared?.task, "1", "task 7's seat");
  assert.deepEqual(b.handle.shared?.task, "2");
  assert.equal(b.handle.shared?.tokenSha256, sha256(b.opened.credential));
  assert.notEqual(a.opened.credential, b.opened.credential);
  assert.match(b.runtime.logged("info").join("\n"), /Sharing pod pod1, already serving/);
  assert.deepEqual(gateways.gateway("pod1")?.status().active, ["1", "2"]);

  // Ten minutes on the pod, US$ 0.12, of which each run pays half; then task 8 alone.
  advance(10 * 60_000);
  const runtime = new FakeRuntime({
    inputs: { handle: a.opened.handle, "ledger-run": "300-1-7" },
  });
  await closeKey(
    fakeServices(new FakePlatform(), runtime, undefined, a.provider, undefined, store),
  );
  assert.equal(runtime.outputs["run-cost"], "0.0600");
  assert.equal(runtime.outputs["pod-shared"], "true");
  // The task's count of the shared pod is its share, as the gateway measured it.
  assert.equal((await store.get("organizations/o/runs/300-1-7"))?.fields.podCost, 0.06);
  assert.equal(runtime.outputs["kept-pod"], "pod1");
  assert.match(
    runtime.logged("info").join("\n"),
    /Kept pod pod1 for the next runs on its settings/,
  );
  advance(10 * 60_000);
  const second = await b.provider.close(b.opened.handle, new FakeRuntime());
  near(second.cost, 0.18);
  assert.deepEqual(second.podCosts, { pod1: 0.18 }, "the shares add up to the pod's 20 minutes");
  assert.ok(gpu.live.has("pod1"), "both tasks keep it");

  // Task 7 does not go on: the pod stays for task 8, until it does not either.
  const released = new FakeRuntime();
  assert.deepEqual(await release(a.opened.handle, released), []);
  assert.match(
    released.logged("info")[0] ?? "",
    /stays for the tasks that still use or keep it \(o\/r#8\)/,
  );
  assert.ok(gpu.live.has("pod1"));
  await release(b.opened.handle);
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("at its concurrency, a full pod's key creates no other pod, and the run is refused", async () => {
  const { gpu, store, open } = setup({ real: true, image: SHARED_IMAGE });
  const capped: Partial<PodSettings> = {
    parallel: 1,
    ollama: { OLLAMA_NUM_PARALLEL: "1" },
    concurrency: { key: "0123456789abcdef", pods: 1 },
  };
  const first = await open("7", "300", capped);
  assert.equal(first.handle.podId, "pod1");
  const [document] = await store.query("pools/o/pods");
  assert.equal(document?.fields.key, "0123456789abcdef", "the pod records its key");
  await assert.rejects(open("8", "300", capped), (error: unknown) => {
    assert.ok(error instanceof ConcurrencyReached);
    assert.equal(error.instances, 1);
    assert.match(error.message, /1 of them run, as many as `concurrency` allows/);
    return true;
  });
  assert.equal(gpu.created.length, 1, "no other pod");
  // Two instances allow a second pod.
  const second = await open("8", "300", {
    ...capped,
    concurrency: { key: "0123456789abcdef", pods: 2 },
  });
  assert.equal(second.handle.podId, "pod2");
});

test("tasks of two repositories with the same issue number share a pod, each with its own seat and share", async () => {
  const { gpu, gateways, open, advance } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300");
  const b = await open("7", "900", {}, { owner: "O", name: "s" });
  assert.equal(gpu.created.length, 1);
  assert.equal(b.handle.podId, "pod1");
  assert.equal(b.handle.holder, "o/s#7");
  assert.deepEqual([a.handle.shared?.task, b.handle.shared?.task], ["1", "2"]);
  assert.deepEqual(gateways.gateway("pod1")?.status().active, ["1", "2"]);
  advance(10 * 60_000);
  const first = await b.provider.close(b.opened.handle, new FakeRuntime());
  near(first.cost, 0.06);
  advance(5 * 60_000);
  const second = await a.provider.close(a.opened.handle, new FakeRuntime());
  near(second.cost, 0.12);
  assert.ok(gpu.live.has("pod1"), "both keep it");
});

test("a task that waits for another's creation lease joins its pod, from its start", async () => {
  const { gpu, gateways, registry, open, advance, setWait } = setup({
    real: true,
    image: SHARED_IMAGE,
  });
  // Task 7 of another job holds the creation lease, and its pod starts.
  const description = {
    settings: podSettingsKey({ ...settings, image: SHARED_IMAGE }, "o/r#7"),
    model: settings.model,
    gpuType: "GPU-A",
    image: SHARED_IMAGE,
    reuse: "task",
    provider: "fake",
  };
  const claim = await registry.claim(description, "o/r#7", "300", 2 * 3_600_000);
  const nonce = claim.pod.nonce;
  const pod = await gpu.pods.create({
    name: "n",
    image: SHARED_IMAGE,
    port: 8080,
    gpuType: "GPU-A",
    diskGb: 1,
    env: {
      CODEMAN_ORGANIZATION: "o",
      CODEMAN_NONCE: nonce,
      CODEMAN_ADMIN_SHA256: sha256(adminToken("account-key", nonce)),
    },
  });
  gateways.state(pod.id).ready = false;
  let waits = 0;
  setWait(async () => {
    waits++;
    if (waits === 1) {
      // While task 8 waits, task 7 registers its pod.
      await registry.register(nonce, {
        pod: pod.id,
        createdAt: pod.createdAt,
        pricePerSecond: 0.0002,
      });
    } else {
      gateways.state(pod.id).ready = true;
      advance(60_000);
    }
  });
  const b = await open("8", "300");
  assert.equal(gpu.created.length, 1);
  assert.equal(b.handle.podId, pod.id);
  assert.equal(b.handle.start, pod.createdAt.getTime(), "its share starts with the pod");
  assert.deepEqual(b.opened.pods, [{ pod: pod.id, event: "joined" }]);
  const log = b.runtime.logged("info").join("\n");
  assert.match(log, /Another task is creating the pod for these settings; waiting for it/);
  assert.match(log, /Sharing pod pod1, from its start/);
});

test("a creator whose lease another task took terminates its own pod and joins the other's", async () => {
  const { gpu, registry, open, advance } = setup({ real: true, image: SHARED_IMAGE });
  const create = gpu.pods.create;
  gpu.pods.create = async (spec) => {
    gpu.pods.create = create;
    // The provider took long: task 8 took the lease over, and created its pod first.
    advance(CREATE_LEASE_MS);
    const description = {
      settings: spec.env.CODEMAN_POD_SETTINGS ?? "",
      model: settings.model,
      gpuType: "GPU-A",
      image: SHARED_IMAGE,
      reuse: "task",
      provider: "fake",
    };
    const claim = await registry.claim(description, "o/r#8", "300", 2 * 3_600_000);
    assert.equal(claim.kind, "create");
    const rival = await create({
      ...spec,
      env: {
        ...spec.env,
        CODEMAN_NONCE: claim.pod.nonce,
        CODEMAN_ADMIN_SHA256: sha256(adminToken("account-key", claim.pod.nonce)),
      },
    });
    await registry.register(claim.pod.nonce, {
      pod: rival.id,
      createdAt: rival.createdAt,
      pricePerSecond: 0.0002,
    });
    advance(1_000);
    return create(spec);
  };
  const a = await open("7", "300");
  assert.deepEqual(gpu.terminated, ["pod2"], "its own, later pod");
  assert.equal(a.handle.podId, "pod1");
  assert.match(
    a.runtime.logged("info").join("\n"),
    /Terminated pod pod2: another task created the pod for these settings first/,
  );
  assert.deepEqual(
    a.opened.pods?.map(({ pod, event }) => [pod, event]),
    [
      ["pod2", "created"],
      ["pod2", "terminated"],
      ["pod1", "joined"],
    ],
  );
});

test("the next run's tasks share the pod they kept, and the time between runs goes to its keepers", async () => {
  const { gpu, open, advance } = setup({ real: true, image: SHARED_IMAGE });
  const first = [await open("7", "300"), await open("8", "300")];
  advance(10 * 60_000);
  for (const run of first) await run.provider.close(run.opened.handle, new FakeRuntime());
  // Both keep the pod for ten minutes, then the next run takes them both on.
  advance(10 * 60_000);
  const a = await open("7", "301");
  const b = await open("8", "301");
  assert.equal(gpu.created.length, 1, "no new pod");
  assert.equal(a.handle.podId, "pod1");
  assert.equal(b.handle.podId, "pod1");
  assert.equal(a.handle.start, Date.parse("2026-10-03T12:20:00Z"));
  assert.deepEqual([a.handle.shared?.task, b.handle.shared?.task], ["1", "2"], "their seats");
  advance(10 * 60_000);
  const usage = await a.provider.close(a.opened.handle, new FakeRuntime());
  near(usage.cost, 0.06);
  // Task 7: half of each run's ten minutes, and half of the ten kept between them.
  near(usage.podCosts?.pod1, 0.18);
});

test("with one pod per run, the last task to leave a shared pod terminates it", async () => {
  const { gpu, open } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300", { reuse: "run" });
  const b = await open("8", "300", { reuse: "run" });
  const runtime = new FakeRuntime();
  const left = await a.provider.close(a.opened.handle, runtime);
  assert.equal(left.keptPod, undefined);
  assert.match(
    runtime.logged("info")[0] ?? "",
    /Left pod pod1 to the tasks that still use or keep it \(o\/r#8\)/,
  );
  assert.deepEqual(gpu.terminated, []);
  await b.provider.close(b.opened.handle, new FakeRuntime());
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a shared pod whose gateway does not answer a close stays for the task that still uses it, and takes no other", async () => {
  const { gpu, gateways, registry, open } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300");
  await open("8", "300");
  gateways.state("pod1").reachable = false;
  await a.provider.close(a.opened.handle, new FakeRuntime());
  assert.deepEqual(gpu.terminated, []);
  assert.equal((await registry.live())[0]?.status, "abandoned");
  gateways.state("pod1").reachable = true;
  const c = await open("9", "300");
  assert.equal(c.handle.podId, "pod2");
});

test("close tries /admin/end again when the pod's gateway fails for a moment", async () => {
  const { gateways, open, advance, setWait } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300");
  assert.equal(a.handle.limit, 1, "the handle carries the run's limit");
  advance(10 * 60_000);
  gateways.state("pod1").reachable = false;
  const waits: number[] = [];
  setWait(async (ms) => {
    waits.push(ms);
    gateways.state("pod1").reachable = true;
  });
  const runtime = new FakeRuntime();
  const usage = await a.provider.close(a.opened.handle, runtime);
  near(usage.cost, 0.12);
  assert.equal(usage.keptPod, "pod1");
  assert.deepEqual(waits, [END_RETRY_MS]);
  assert.equal(gateways.calls.filter((call) => call.endsWith(" /admin/end")).length, 2);
  assert.deepEqual(runtime.logged("warning"), []);
});

test("a shared pod's run whose gateway never answers counts the pod's time, capped at its limit", async () => {
  const { gateways, open, advance } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300", {}, repository, 0.05);
  const b = await open("8", "300", {}, repository, 0.05);
  // Ten minutes: US$ 0.12 of the pod's time, of which the gateway would give each run its limit.
  advance(10 * 60_000);
  gateways.state("pod1").reachable = false;
  const runtime = new FakeRuntime();
  const usage = await a.provider.close(a.opened.handle, runtime);
  assert.equal(usage.cost, 0.05);
  assert.equal(usage.inputTokens, undefined);
  assert.equal(gateways.calls.filter((call) => call.endsWith(" /admin/end")).length, END_ATTEMPTS);
  const warnings = runtime.logged("warning").join("\n");
  assert.match(warnings, /Could not read the run's usage from its pod after 3 tries/);
  assert.match(
    warnings,
    /The run's cost is an estimate, since its pod's gateway did not report it: the pod's time since the run started, US\$ 0\.12, capped at the run's limit, US\$ 0\.05\./,
  );
  // A handle from before it carried the limit keeps the pod's whole time.
  const { limit: _, ...older } = b.handle;
  near((await b.provider.close(JSON.stringify(older), new FakeRuntime())).cost, 0.12);
});

test("a close whose gateway does not know the run warns, and counts the estimate", async () => {
  const { open, advance } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300");
  advance(5 * 60_000);
  const shared = { task: a.handle.shared?.task, tokenSha256: "0".repeat(64) };
  const runtime = new FakeRuntime();
  const usage = await a.provider.close(JSON.stringify({ ...a.handle, shared }), runtime);
  near(usage.cost, 0.06);
  const warnings = runtime.logged("warning").join("\n");
  assert.match(warnings, /Pod pod1's gateway does not know this run, as after a restart/);
  assert.match(warnings, /The run's cost is an estimate/);
});

test("a task that cannot join its settings' pod abandons it and creates another", async () => {
  const { gpu, gateways, registry, open, advance } = setup({ real: true, image: SHARED_IMAGE });
  await open("7", "300");
  advance(30 * 60_000);
  gateways.state("pod1").reachable = false;
  const b = await open("8", "300");
  assert.equal(b.handle.podId, "pod2");
  assert.match(b.runtime.logged("warning")[0] ?? "", /Could not join pod pod1/);
  assert.deepEqual(gpu.terminated, [], "task 7's run still holds pod 1");
  const statuses = (await registry.live()).map((pod) => [pod.pod, pod.status]);
  assert.deepEqual(statuses, [
    ["pod1", "abandoned"],
    ["pod2", "serving"],
  ]);
});

test("a pod whose gateway serves one run at a time, on an image not listed as such, fails the run", async () => {
  const { gpu, open } = setup({ image: SHARED_IMAGE });
  await assert.rejects(
    open("7", "300"),
    /serves one run at a time: list its image in SINGLE_RUN_IMAGES/,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("the image pinned before shared pods gives each task a pod of its own", async () => {
  const { gpu, open } = setup({ real: true });
  const a = await open("7", "300");
  const b = await open("8", "300");
  assert.deepEqual([a.handle.podId, b.handle.podId], ["pod1", "pod2"]);
  assert.notEqual(
    gpu.created[0]?.env.CODEMAN_POD_SETTINGS,
    gpu.created[1]?.env.CODEMAN_POD_SETTINGS,
  );
});

test("Ollama settings are part of a pod's settings, only when there are some", () => {
  const shared = { ...settings, image: SHARED_IMAGE };
  // Without them, the hash pods had before Ollama settings: those pods are still found.
  const before = sha256(["qwen3-coder:30b", "GPU-A", SHARED_IMAGE, "task"].join("\n")).slice(0, 16);
  assert.equal(podSettingsKey(shared, "o/r#7"), before);
  assert.equal(podSettingsKey({ ...shared, ollama: {} }, "o/r#7"), before);
  const four = podSettingsKey({ ...shared, ollama: { OLLAMA_NUM_PARALLEL: "4" } }, "o/r#7");
  assert.notEqual(four, before);
  assert.notEqual(
    four,
    podSettingsKey({ ...shared, ollama: { OLLAMA_NUM_PARALLEL: "2" } }, "o/r#7"),
  );
});

test("a pod gets its Ollama settings in its environment, and tasks with others get another pod", async () => {
  const { gpu, open } = setup({ real: true, image: SHARED_IMAGE });
  const variables = { OLLAMA_CONTEXT_LENGTH: "65536", OLLAMA_NUM_PARALLEL: "4" };
  const a = await open("7", "300", { ollama: variables });
  const b = await open("8", "300", { ollama: variables });
  assert.equal(a.handle.podId, b.handle.podId, "the same settings share the pod");
  assert.equal(
    gpu.created[0]?.env.CODEMAN_OLLAMA,
    '{"OLLAMA_CONTEXT_LENGTH":"65536","OLLAMA_NUM_PARALLEL":"4"}',
  );
  const c = await open("9", "300", { ollama: { OLLAMA_NUM_PARALLEL: "2" } });
  const d = await open("10", "300");
  assert.deepEqual([c.handle.podId, d.handle.podId], ["pod2", "pod3"]);
  assert.equal(gpu.created[2]?.env.CODEMAN_OLLAMA, undefined, "none without settings");
});

test("an image that cannot apply Ollama settings is refused before any pod is created", async () => {
  assert.equal(IMAGES_WITHOUT_OLLAMA_SETTINGS.size, 2);
  for (const image of IMAGES_WITHOUT_OLLAMA_SETTINGS) {
    const { gpu, open } = setup({ image, real: true });
    await assert.rejects(
      open("7", "300", { ollama: { OLLAMA_NUM_PARALLEL: "4" } }),
      (error: unknown) =>
        error instanceof OpenFailure &&
        error.message ===
          `The pod image ${image} cannot apply Ollama settings (\`OLLAMA_NUM_PARALLEL=4\`), so no pod was created: use a version of Codeman whose pod image can, or remove \`ollama\` from the settings. See docs/settings/ollama.md#pod-images.`,
    );
    assert.deepEqual(gpu.created, []);
    // Without Ollama settings, the image serves as before.
    assert.ok((await open("8", "300")).handle.podId);
  }
});

test("an image whose gateway cannot serve on the provider is refused before any pod is created", async () => {
  const image = [...IMAGES_BEFORE_SALAD][0] ?? "";
  const gpu = new FakeGpu({ unservedImages: IMAGES_BEFORE_SALAD });
  const inference = new PodInference(
    { ...settings, image },
    { repository, gpu, account: { key: "account-key" }, store: new MemoryStore() },
  );
  await assert.rejects(
    inference.open(
      { task: "7", runId: "300", limit: 1, reservationMs: 3_600_000 },
      new FakeRuntime(),
    ),
    (error: unknown) =>
      error instanceof OpenFailure &&
      error.message.startsWith(
        `The pod image ${image} cannot serve on Fake, so no pod was created`,
      ),
  );
  assert.deepEqual(gpu.created, []);
  // The images pinned now serve on Salad: the ones they replaced stay listed.
  for (const pinned of Object.values(POD_IMAGES)) assert.ok(!IMAGES_BEFORE_SALAD.has(pinned));
  assert.ok(!IMAGES_BEFORE_SALAD.has(SHARED_IMAGE));
});

test("an Ollama model reads images when the pod's gateway says Ollama lists its vision capability", async () => {
  const { gateways, open } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300", { parallel: 4 });
  assert.equal(a.handle.vision, undefined);
  assert.ok(
    a.runtime
      .logged("info")
      .includes(
        "Ollama does not list the vision capability of qwen3-coder:30b: the agent reads text only.",
      ),
  );
  const gateway = gateways.gateway("pod1");
  assert.ok(gateway);
  gateway.fit = { ...(gateway.fit as FitReport), vision: true };
  const b = await open("8", "300", { parallel: 4 });
  assert.equal(b.handle.podId, "pod1");
  assert.equal(b.handle.vision, true);
  assert.ok(
    b.runtime
      .logged("info")
      .includes("Ollama lists the vision capability of qwen3-coder:30b: the agent reads images."),
  );
});

test("a gateway that does not report it leaves an Ollama model text only", async () => {
  const { open } = setup();
  const { handle, runtime } = await open("7", "300");
  assert.equal(handle.vision, undefined);
  assert.ok(
    runtime
      .logged("info")
      .includes(
        "Pod pod1's gateway does not say whether qwen3-coder:30b reads images: the agent reads text only.",
      ),
  );
});

test("a pod whose gateway does not apply the Ollama settings fails the run, and is terminated", async () => {
  const { gpu, gateways, open } = setup({ image: SHARED_IMAGE });
  gateways.state("pod1").version = GATEWAY_VERSION;
  await assert.rejects(
    open("7", "300", { ollama: { OLLAMA_NUM_PARALLEL: "4" } }),
    /Pod pod1's gateway did not apply the Ollama settings \(`OLLAMA_NUM_PARALLEL=4`\): its image cannot\./,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("on an image that fits the GPU, num-parallel defaults to the profile's count; the settings' own wins", async () => {
  const { gpu, open } = setup({ real: true, image: SHARED_IMAGE });
  const a = await open("7", "300", { parallel: 4 });
  const pod = gpu.created[0];
  assert.equal(pod?.env.CODEMAN_OLLAMA, '{"OLLAMA_NUM_PARALLEL":"4"}');
  assert.equal(pod?.env.CODEMAN_GPU_MEMORY_GB, "48", "the GPU type's memory, for the estimate");
  assert.equal(pod?.env.CODEMAN_FIT, undefined, "nothing cached yet");
  const shared = { ...settings, image: SHARED_IMAGE };
  const key = podSettingsKey({ ...shared, ollama: { OLLAMA_NUM_PARALLEL: "4" } }, "o/r#7");
  assert.equal(pod?.name, `codeman-o-${key}`, "the derived value is part of the settings key");
  assert.ok(
    a.runtime
      .logged("info")
      .includes(
        "Pod pod1 serves qwen3-coder:30b with 4 parallel request(s) and a context of 65536 tokens (the model's own is 262144), wholly on the GPU; found in 5 load(s).",
      ),
  );
  assert.equal(a.opened.contextLength, 65536, "the agent is told the context served");
  const b = await open("8", "300", { parallel: 4, ollama: { OLLAMA_NUM_PARALLEL: "2" } });
  assert.equal(b.handle.podId, "pod2");
  assert.equal(gpu.created[1]?.env.CODEMAN_OLLAMA, '{"OLLAMA_NUM_PARALLEL":"2"}');
  const c = await open("9", "300", { parallel: 4 });
  assert.equal(c.handle.podId, "pod1", "the same derived settings share the pod");
});

test("an image pinned before Ollama settings gets no derived settings, no cache, and keeps its key", async () => {
  for (const image of IMAGES_WITHOUT_OLLAMA_SETTINGS) {
    const { gpu, store, open } = setup({ image, real: true });
    const { runtime } = await open("7", "300", { parallel: 4 });
    const env = gpu.created[0]?.env ?? {};
    assert.equal(env.CODEMAN_OLLAMA, undefined);
    assert.equal(env.CODEMAN_FIT, undefined);
    assert.equal(env.CODEMAN_GPU_MEMORY_GB, undefined);
    const key = podSettingsKey({ ...settings, image }, "o/r#7");
    assert.equal(gpu.created[0]?.name, `codeman-o-${key}`, "the key it had before");
    assert.ok(
      runtime
        .logged("info")
        .includes(
          `The pod image ${image} predates Ollama settings: its pods serve one request at a time, with the model's own context length, and nothing checks that the model fits the GPU. See docs/settings/ollama.md#pod-images.`,
        ),
    );
    assert.deepEqual(await store.query(LAYOUT.contexts()), []);
  }
});

test("the cache of fits: written after a search by the pod's creator, read into the next pod", async () => {
  const { gpu, store, open } = setup({ real: true, image: SHARED_IMAGE });
  await open("7", "300", { parallel: 4 });
  await open("8", "300", { parallel: 4 });
  const variables = { OLLAMA_NUM_PARALLEL: "4" };
  const key = fitKey({ ...settings, image: SHARED_IMAGE, ollama: variables });
  const path = LAYOUT.context(key);
  const cached = await store.get(path);
  const { recordedAt, ...fields } = cached?.fields ?? {};
  assert.deepEqual(fields, {
    image: SHARED_IMAGE,
    model: "qwen3-coder:30b",
    digest: "digest-1",
    gpuType: "GPU-A",
    ollama: variables,
    contextLength: 65536,
    modelContextLength: 262144,
    parallel: 4,
    loads: 5,
    pod: "pod1",
  });
  assert.ok(recordedAt instanceof Date);
  assert.equal(
    fitKey({
      ...settings,
      image: SHARED_IMAGE,
      ollama: { ...variables, OLLAMA_CONTEXT_LENGTH: "9" },
    }),
    key,
    "the context length is not part of the key",
  );
  assert.notEqual(
    fitKey({
      ...settings,
      image: SHARED_IMAGE,
      ollama: { ...variables, OLLAMA_KV_CACHE_TYPE: "q8_0" },
    }),
    key,
  );

  // The next pod of these settings starts from the cached context; nothing is written again.
  gpu.setStatus("pod1", "terminated");
  const { runtime } = await open("9", "301", { parallel: 4 });
  assert.equal(gpu.created[1]?.env.CODEMAN_FIT, '{"contextLength":65536,"digest":"digest-1"}');
  assert.ok(
    runtime
      .logged("info")
      .some((line) => line.endsWith("wholly on the GPU; from the cache of fits.")),
  );
  assert.equal((await store.get(path))?.version, cached?.version);

  // A context in the settings needs no cache.
  await open("10", "302", { parallel: 4, ollama: { OLLAMA_CONTEXT_LENGTH: "32768" } });
  assert.equal(gpu.created[2]?.env.CODEMAN_FIT, undefined);
  assert.equal((await store.query(LAYOUT.contexts())).length, 1);
});

test("a cache of fits that cannot be read leaves the pod to search", async () => {
  const { gpu, store, open } = setup({ real: true, image: SHARED_IMAGE });
  const get = store.get.bind(store);
  store.get = async (path: string) => {
    if (path.startsWith("contexts/")) throw new Error("unavailable");
    return get(path);
  };
  const { runtime } = await open("7", "300", { parallel: 4 });
  assert.equal(gpu.created[0]?.env.CODEMAN_FIT, undefined);
  assert.ok(
    runtime
      .logged("warning")
      .includes(
        "Could not read the cache of fits (unavailable); the pod searches for the context that fits.",
      ),
  );
});

test("a gateway that applies Ollama settings but does not report the fit fails the run", async () => {
  const { gpu, gateways, open } = setup({ image: SHARED_IMAGE });
  gateways.state("pod1").version = GATEWAY_VERSION;
  await assert.rejects(
    open("7", "300"),
    /Pod pod1's gateway did not report how qwen3-coder:30b fits the GPU: its image cannot check it\. List the image in IMAGES_WITHOUT_OLLAMA_SETTINGS/,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a model that does not fit fails the run with the gateway's reason, and no other pod is tried", async () => {
  const reason =
    "`qwen3-coder:30b` does not fit the GPU with 4 parallel requests and a context of 64000 tokens, the least Codeman gives an agent: Ollama put 3.2 of its 43.6 GB off the GPU, which runs much slower.";
  const failing = setup({ real: true, image: SHARED_IMAGE });
  failing.gateways.state("pod1").ready = false;
  failing.gateways.state("pod1").failure = reason;
  await assert.rejects(
    failing.open("7", "300", { parallel: 4 }),
    (error: Error) => error.message === `Pod pod1 did not serve qwen3-coder:30b: ${reason}`,
  );
  assert.deepEqual(failing.gpu.terminated, ["pod1"]);
  assert.equal(failing.gpu.created.length, 1);

  // A task that joins a pod whose start failed fails too, without creating another.
  const joining = setup({ real: true, image: SHARED_IMAGE });
  await joining.open("7", "300", { parallel: 4 });
  joining.gateways.state("pod1").ready = false;
  joining.gateways.state("pod1").failure = reason;
  await assert.rejects(joining.open("8", "300", { parallel: 4 }), /did not serve/);
  assert.equal(joining.gpu.created.length, 1);
});

test("a task that waits for a pod whose start fails fails with it, after its creator terminated it", async () => {
  const reason = "`qwen3-coder:30b` does not fit the GPU.";
  const message = `Pod pod1 did not serve qwen3-coder:30b: ${reason}`;
  const { gpu, gateways, registry, open, setWait } = setup({ real: true, image: SHARED_IMAGE });
  gateways.state("pod1").ready = false;
  let joining: Promise<unknown> | undefined;
  let joinerWaits = () => {};
  const joinerWaiting = new Promise<void>((resolve) => {
    joinerWaits = resolve;
  });
  let creatorFailed = () => {};
  const creatorDone = new Promise<void>((resolve) => {
    creatorFailed = resolve;
  });
  let waits = 0;
  setWait(async () => {
    waits++;
    if (waits === 1) {
      // Task 7 created pod 1 and waits for it; task 8 joins it and waits too.
      joining = open("8", "300", { parallel: 4 }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await Promise.race([joinerWaiting, joining]);
      gateways.state("pod1").failure = reason;
    } else if (waits === 2) {
      joinerWaits();
      // Task 8 polls again only once task 7 read the failure and terminated the pod.
      await creatorDone;
    }
  });
  await assert.rejects(
    open("7", "300", { parallel: 4 }),
    (error: Error) => error.message === message,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
  creatorFailed();
  const failure = await joining;
  assert.ok(failure instanceof Error, "task 8 fails too");
  assert.equal(failure.message, message);
  assert.equal(gpu.created.length, 1, "no other pod");
  assert.deepEqual(await registry.live(), []);
});

/**
 * vLLM pods: an image of their own, a fake Hugging Face, and the test model. `vision` says which
 * models read images; the others read text only.
 */
function vllmSetup(
  models: Record<string, number | Error> = { "unsloth/Qwen3.8-27B-NVFP4": 23.4e9 },
  vision: Record<string, boolean | Error> = {},
) {
  const asked: string[] = [];
  const configs: string[] = [];
  const hub: ModelHub = {
    model: async (id) => {
      asked.push(id);
      const found = models[id];
      if (found instanceof Error) throw found;
      if (found === undefined) throw new Error(`Hugging Face has no public model \`${id}\`.`);
      return { id, weightsBytes: found };
    },
    vision: async (id) => {
      configs.push(id);
      const found = vision[id] ?? false;
      if (found instanceof Error) throw found;
      return found;
    },
  };
  return { ...setup({ real: true, image: VLLM_IMAGE, hub }), asked, configs };
}
const VLLM_IMAGE = "ghcr.io/o/codeman-vllm@sha256:2";
const onVllm: Partial<PodSettings> = {
  engine: vllm,
  model: "unsloth/Qwen3.8-27B-NVFP4",
  vllm: { "kv-cache-dtype": "fp8", "tool-call-parser": "qwen3_xml" },
  parallel: 4,
};

test("a vLLM pod gets its settings with max-num-seqs, vLLM's CUDA, and a disk for its model", async () => {
  const { gpu, open, asked } = vllmSetup();
  const { opened, runtime } = await open("7", "300", onVllm);
  const spec = gpu.created[0];
  assert.equal(spec?.image, VLLM_IMAGE);
  assert.equal(spec?.minCudaVersion, "13.0");
  assert.equal(spec?.diskGb, 80, "23.4 GB of weights fit the least disk");
  assert.equal(spec?.env.CODEMAN_ENGINE, "vllm");
  assert.equal(
    spec?.env.CODEMAN_VLLM,
    '{"kv-cache-dtype":"fp8","max-num-seqs":"4","tool-call-parser":"qwen3_xml"}',
  );
  for (const name of ["CODEMAN_OLLAMA", "CODEMAN_GPU_MEMORY_GB", "CODEMAN_FIT"]) {
    assert.equal(spec?.env[name], undefined, name);
  }
  assert.deepEqual(asked, ["unsloth/Qwen3.8-27B-NVFP4"]);
  const key = podSettingsKey(
    { ...settings, ...onVllm, image: VLLM_IMAGE, vllm: podVllm(onVllm) },
    "o/r#7",
  );
  assert.equal(spec?.name, `codeman-o-${key}`);
  const info = runtime.logged("info");
  assert.ok(info.includes("Pod pod1 runs on a host with CUDA 13.0."));
  assert.ok(
    info.includes(
      "Hugging Face serves unsloth/Qwen3.8-27B-NVFP4: 23.4 GB of weights, so the pod gets 80 GB of disk.",
    ),
  );
  assert.ok(
    info.includes(
      "Pod pod1 serves unsloth/Qwen3.8-27B-NVFP4 with vLLM, 4 parallel request(s) and a context of 131072 tokens (the model's own is 262144), wholly on the GPU: its K/V cache holds 4.50 requests of it (589824 tokens); found in 2 start(s). Its tool calls work with the parser qwen3_xml.",
    ),
  );
  assert.equal(opened.contextLength, 131072, "the agent is told the context served");
  const joined = await open("8", "300", onVllm);
  assert.equal(joined.handle.podId, "pod1", "the same settings share the pod");
  assert.deepEqual(asked, ["unsloth/Qwen3.8-27B-NVFP4"], "only a new pod checks the model");
});

test("a vLLM pod's settings key has its engine and settings; Ollama pods keep theirs", () => {
  const shared = { ...settings, image: SHARED_IMAGE };
  const before = sha256(["qwen3-coder:30b", "GPU-A", SHARED_IMAGE, "task"].join("\n")).slice(0, 16);
  assert.equal(podSettingsKey({ ...shared, engine: ollama }, "o/r#7"), before);
  const vllmPod = { ...shared, engine: vllm, vllm: { "max-num-seqs": "4" } };
  const four = podSettingsKey(vllmPod, "o/r#7");
  assert.equal(
    four,
    sha256(
      ["qwen3-coder:30b", "GPU-A", SHARED_IMAGE, "task", "engine vllm", "vllm max-num-seqs=4"].join(
        "\n",
      ),
    ).slice(0, 16),
  );
  assert.notEqual(four, podSettingsKey({ ...vllmPod, vllm: { "max-num-seqs": "3" } }, "o/r#7"));
  assert.deepEqual(
    podVllm({ vllm: { "max-num-seqs": "2", "tool-call-parser": "hermes" }, parallel: 4 }),
    {
      "max-num-seqs": "2",
      "tool-call-parser": "hermes",
    },
  );
  assert.deepEqual(podVllm({ vllm: { "tool-call-parser": "hermes" } }), {
    "tool-call-parser": "hermes",
  });
  assert.notEqual(
    fitKey({ ...vllmPod, ollama: {} }),
    fitKey({ ...shared, ollama: {} }),
    "the cache of fits keys the engine too",
  );
  assert.equal(
    fitKey({ ...vllmPod, ollama: {}, vllm: { ...vllmPod.vllm, "max-model-len": "9" } }),
    fitKey({ ...vllmPod, ollama: {} }),
    "the context is not part of the key",
  );
  assert.deepEqual([vllmDiskGb(0), vllmDiskGb(23.4e9), vllmDiskGb(100e9)], [80, 80, 165]);
});

const QWEN = "unsloth/Qwen3.8-27B-NVFP4";

test("a vLLM model with a vision tower reads images, on a created pod and a joined one", async () => {
  const { open, configs } = vllmSetup(undefined, { [QWEN]: true });
  const created = await open("7", "300", onVllm);
  assert.equal(created.handle.vision, true, "the agent job reads it from the handle");
  assert.ok(
    created.runtime
      .logged("info")
      .includes(
        `${QWEN}'s configuration on Hugging Face has a vision tower, which vLLM serves: the agent reads images.`,
      ),
  );
  const joined = await open("8", "300", onVllm);
  assert.equal(joined.handle.podId, "pod1");
  assert.equal(joined.handle.vision, true);
  assert.deepEqual(configs, [QWEN, QWEN], "each run checks it, a join too");
});

test("with language-model-only, or without a vision tower, a vLLM model reads text only", async () => {
  const skipped = vllmSetup(undefined, { [QWEN]: true });
  const languageOnly = { ...onVllm, vllm: { ...onVllm.vllm, "language-model-only": "true" } };
  const a = await skipped.open("7", "300", languageOnly);
  assert.equal(a.handle.vision, undefined);
  assert.deepEqual(skipped.configs, [], "nothing to ask Hugging Face");
  assert.ok(
    a.runtime
      .logged("info")
      .includes(
        `\`language-model-only\` keeps vLLM from serving ${QWEN}'s vision tower: the agent reads text only.`,
      ),
  );
  const textOnly = vllmSetup();
  const b = await textOnly.open("7", "300", onVllm);
  assert.equal(b.handle.vision, undefined);
  assert.ok(
    b.runtime
      .logged("info")
      .includes(
        `${QWEN}'s configuration on Hugging Face has no vision tower: the agent reads text only.`,
      ),
  );
});

test("a configuration that cannot be read leaves a vLLM model text only, and the run goes on", async () => {
  const { open } = vllmSetup(undefined, { [QWEN]: new Error("Hugging Face answered 503.") });
  const { opened, handle, runtime } = await open("7", "300", onVllm);
  assert.equal(handle.vision, undefined);
  assert.ok(opened.credential, "the run has its access");
  assert.ok(
    runtime
      .logged("info")
      .includes(
        `Could not tell whether ${QWEN} reads images: Hugging Face answered 503. The agent reads text only.`,
      ),
  );
});

test("without a pinned vLLM image, a run stops before any pod, at no cost", async () => {
  const { gpu, registry, open, asked } = vllmSetup();
  await assert.rejects(
    open("7", "300", { ...onVllm, image: "" }),
    (error: unknown) =>
      error instanceof OpenFailure &&
      error.message ===
        "This version of Codeman pins no vLLM pod image yet (`POD_IMAGES` in src/inference/images.ts), so no pod was created: use a version that pins one, or `engine: ollama`. See docs/settings/vllm.md#pod-images.",
  );
  assert.deepEqual(gpu.created, []);
  assert.deepEqual(asked, []);
  assert.deepEqual(await registry.live(), []);
});

test("without a host that offers vLLM's CUDA now, a run stops before creating the pod", async () => {
  const { gpu, registry, open } = vllmSetup();
  gpu.cuda["GPU-A"] = [
    { version: "12.8", available: true },
    { version: "13.0", available: false },
    { version: "13.1", available: false },
  ];
  await assert.rejects(
    open("7", "300", onVllm),
    /^Error: No host with GPU-A and CUDA 13\.0 or newer has room now \(Fake offers 13\.0, 13\.1\), which vLLM's image needs, so no pod was created: try again later, or use another GPU type\.$/,
  );
  gpu.cuda["GPU-A"] = [{ version: "12.8", available: true }];
  await assert.rejects(
    open("8", "300", onVllm),
    /Fake offers no host with GPU-A and CUDA 13\.0 or newer/,
  );
  assert.deepEqual(gpu.created, []);
  assert.deepEqual(await registry.live(), [], "the creation leases ended");
  // Ollama pods ask for no CUDA version.
  const ollamaPods = setup({ real: true, image: SHARED_IMAGE });
  ollamaPods.gpu.cuda["GPU-A"] = [];
  await ollamaPods.open("7", "300");
  assert.equal(ollamaPods.gpu.created[0]?.minCudaVersion, undefined);
});

test("a model Hugging Face does not serve publicly stops the run before creating the pod", async () => {
  const gated = new Error("`a/gated` is gated on Hugging Face.");
  const { gpu, open, asked } = vllmSetup({ "a/gated": gated, "org/drafter": 1e9 });
  await assert.rejects(
    open("7", "300", { ...onVllm, model: "a/gated" }),
    /is gated on Hugging Face/,
  );
  await assert.rejects(
    open("8", "300", { ...onVllm, model: "a/missing" }),
    /no public model `a\/missing`/,
  );
  assert.deepEqual(gpu.created, []);
  assert.deepEqual(asked, ["a/gated", "a/missing"]);
});

test("a draft model is checked too, and its weights count in the disk", async () => {
  const { gpu, open, asked } = vllmSetup({ "org/big": 90e9, "org/drafter": 10e9 });
  await open("7", "300", {
    ...onVllm,
    model: "org/big",
    vllm: {
      "tool-call-parser": "hermes",
      "speculative-method": "eagle3",
      "speculative-tokens": "3",
      "speculative-model": "org/drafter",
    },
  });
  assert.deepEqual(asked, ["org/big", "org/drafter"]);
  assert.equal(gpu.created[0]?.diskGb, 165);
});

test("vLLM's cache of fits: written after the creator's search, read into the next pod", async () => {
  const { gpu, store, open } = vllmSetup();
  await open("7", "300", onVllm);
  const values = { "kv-cache-dtype": "fp8", "max-num-seqs": "4", "tool-call-parser": "qwen3_xml" };
  const key = fitKey({ ...settings, ...onVllm, image: VLLM_IMAGE, ollama: {}, vllm: values });
  const cached = await store.get(LAYOUT.context(key));
  const { recordedAt, ...fields } = cached?.fields ?? {};
  assert.deepEqual(fields, {
    engine: "vllm",
    image: VLLM_IMAGE,
    model: "unsloth/Qwen3.8-27B-NVFP4",
    gpuType: "GPU-A",
    vllm: values,
    contextLength: 131072,
    modelContextLength: 262144,
    parallel: 4,
    concurrency: 4.5,
    cacheTokens: 589824,
    loads: 2,
    pod: "pod1",
  });
  assert.ok(recordedAt instanceof Date);
  gpu.setStatus("pod1", "terminated");
  const { runtime } = await open("8", "301", onVllm);
  assert.equal(gpu.created[1]?.env.CODEMAN_FIT, '{"contextLength":131072}');
  assert.ok(runtime.logged("info").some((line) => line.includes("; from the cache of fits.")));
  assert.equal((await store.get(LAYOUT.context(key)))?.version, cached?.version);
  // An explicit context needs no cache, and writes none.
  await open("9", "302", { ...onVllm, vllm: { ...onVllm.vllm, "max-model-len": "65536" } });
  assert.equal(gpu.created[2]?.env.CODEMAN_FIT, undefined);
  assert.equal((await store.query(LAYOUT.contexts())).length, 1);
});

test("a vLLM pod whose gateway does not report vLLM's settings and fit fails the run", async () => {
  // Not Codeman's gateway: it answers as one that knows nothing of vLLM.
  const hub: ModelHub = {
    model: async (id) => ({ id, weightsBytes: 1e9 }),
    vision: async () => false,
  };
  const { gpu, gateways, open } = setup({ image: VLLM_IMAGE, hub });
  gateways.state("pod1").version = GATEWAY_VERSION;
  await assert.rejects(
    open("7", "300", onVllm),
    /Pod pod1's gateway did not apply the vLLM settings \(`kv-cache-dtype=fp8`, `max-num-seqs=4`, `tool-call-parser=qwen3_xml`\): its image cannot\./,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a pod carries its pool and its account's fingerprint, never the key; its document its capacity", async () => {
  const { gpu, store, open } = setup({ image: SHARED_IMAGE });
  await open("7", "300", { parallel: 4, ollama: { OLLAMA_NUM_PARALLEL: "4" } }).catch(
    () => undefined,
  );
  const env = gpu.created[0]?.env ?? {};
  assert.equal(env.CODEMAN_POOL, "o");
  assert.equal(env.CODEMAN_ACCOUNT, accountFingerprint({ key: "account-key" }));
  assert.match(env.CODEMAN_ACCOUNT ?? "", /^[0-9a-f]{16}$/);
  assert.notEqual(
    accountFingerprint({ key: "account-key" }),
    accountFingerprint({ key: "another-key" }),
  );
  const [pod] = await store.query("pools/o/pods");
  assert.deepEqual(
    [pod?.fields.account, pod?.fields.capacity, pod?.fields.organization],
    [accountFingerprint({ key: "account-key" }), 4, "o"],
  );
  assert.equal(podCapacity({ ollama: { OLLAMA_NUM_PARALLEL: "3" } }), 3);
  assert.equal(podCapacity({ vllm: { "max-num-seqs": "2" } }), 2);
  assert.equal(podCapacity({ ollama: {} }), undefined, "no limit, as before batches");
});

test("an account that names its organization and project gets a fingerprint of its own for each", () => {
  // Runpod's names neither: its fingerprint is the one its pods carried before Salad's.
  assert.equal(
    accountFingerprint({ key: "account-key" }),
    createHmac("sha256", "account-key")
      .update("codeman-account-fingerprint")
      .digest("hex")
      .slice(0, 16),
  );
  const salad = { key: "account-key", organization: "acme", project: "codeman" };
  const fingerprints = [
    accountFingerprint({ key: "account-key" }),
    accountFingerprint(salad),
    accountFingerprint({ ...salad, project: "other" }),
    accountFingerprint({ ...salad, organization: "globex" }),
  ];
  assert.equal(new Set(fingerprints).size, 4);
  assert.equal(accountFingerprint(salad), accountFingerprint({ ...salad }));
});

test("the sweep ends the pool's pods and this organization's older ones that no registry holds", async () => {
  const { gpu, store, open } = setup();
  const spec: PodSpec = {
    image: ONE_RUN_IMAGE,
    port: 8080,
    gpuType: "GPU-A",
    diskGb: 1,
    name: "n",
    env: {},
  };
  const create = async (env: Record<string, string>) =>
    (await gpu.pods.create({ ...spec, env })).id;
  const pool = await create({ CODEMAN_POOL: "o", CODEMAN_ORGANIZATION: "o", CODEMAN_NONCE: "a" });
  const older = await create({ CODEMAN_ORGANIZATION: "o", CODEMAN_NONCE: "b" });
  const heldElsewhere = await create({
    CODEMAN_POOL: "o+z",
    CODEMAN_ORGANIZATION: "o",
    CODEMAN_NONCE: "c",
  });
  const leftElsewhere = await create({
    CODEMAN_POOL: "o+z",
    CODEMAN_ORGANIZATION: "o",
    CODEMAN_NONCE: "d",
  });
  const othersInPool = await create({
    CODEMAN_POOL: "o+z",
    CODEMAN_ORGANIZATION: "z",
    CODEMAN_NONCE: "e",
  });
  const anotherPool = await create({
    CODEMAN_POOL: "q",
    CODEMAN_ORGANIZATION: "q",
    CODEMAN_NONCE: "f",
  });
  await store.write([
    { op: "create", path: "pools/o+z/pods/c", fields: { live: true, status: "serving" } },
    { op: "create", path: "pools/o+z/pods/d", fields: { live: false, status: "ended" } },
  ]);
  await open("7", "300");
  assert.deepEqual(gpu.terminated.sort(), [pool, older, leftElsewhere].sort());
  for (const id of [heldElsewhere, othersInPool, anotherPool]) assert.ok(gpu.live.has(id), id);
});

test("a registered pod of another account is neither joined nor swept", async () => {
  const { gpu, registry, open } = setup();
  const claim = await registry.claim(
    {
      settings: podSettingsKey(settings, "o/r#7"),
      model: settings.model,
      gpuType: "GPU-A",
      image: ONE_RUN_IMAGE,
      reuse: "task",
      provider: "fake",
      account: "another-account",
    },
    "o/s#1",
    "200",
    2 * 3_600_000,
  );
  await registry.register(claim.pod.nonce, {
    pod: "elsewhere",
    createdAt: new Date("2026-10-03T11:00:00Z"),
    pricePerSecond: 0.0002,
  });
  const { handle } = await open("7", "300");
  assert.notEqual(handle.nonce, claim.pod.nonce, "a pod of its own account");
  assert.ok(!gpu.terminated.includes("elsewhere"));
  assert.ok((await registry.live()).some((pod) => pod.nonce === claim.pod.nonce));
});

test("a pod's kinds of host and priority reach its creation, and its price is its host's", async () => {
  const { gpu, open } = setup();
  gpu.communityPrices["GPU-A"] = 0.0001;
  const { handle, runtime } = await open("7", "300", {
    hosts: ["community", "secure"],
    priority: "on-demand",
  });
  assert.deepEqual(gpu.created[0]?.hosts, ["community", "secure"]);
  assert.equal(gpu.created[0]?.priority, "on-demand");
  assert.equal(handle.pricePerSecond, 0.0001);
  const infos = runtime.logs.map(({ message }) => message);
  assert.ok(
    infos.some((line) => line.includes("on community hosts, at US$ 0.36 per hour")),
    infos.join("\n"),
  );
  // The defaults leave the spec as it was: the provider's own defaults apply.
  await open("8", "300");
  assert.equal(gpu.created[1]?.hosts, undefined);
  assert.equal(gpu.created[1]?.priority, undefined);
});

test("kinds of host and a priority are part of a pod's settings, only when not the defaults", () => {
  const shared = { ...settings, image: SHARED_IMAGE };
  const before = sha256(["qwen3-coder:30b", "GPU-A", SHARED_IMAGE, "task"].join("\n")).slice(0, 16);
  assert.equal(podSettingsKey({ ...shared, hosts: ["secure"] }, "o/r#7"), before);
  const community = podSettingsKey({ ...shared, hosts: ["community", "secure"] }, "o/r#7");
  assert.notEqual(community, before);
  assert.notEqual(
    podSettingsKey({ ...shared, hosts: ["secure", "community"] }, "o/r#7"),
    community,
  );
  assert.notEqual(podSettingsKey({ ...shared, priority: "low" }, "o/r#7"), before);
});
