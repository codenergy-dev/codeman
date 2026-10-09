import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GATEWAY_VERSION, sha256 } from "../gateway/gateway.ts";
import { closeKey, openKey } from "../steps/keys.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeGateways, FakeGpu } from "../testing/fake-gpu.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { seedRuns } from "../testing/ledger-runs.ts";
import type { PodSpec } from "./gpu.ts";
import { IMAGES_WITHOUT_OLLAMA_SETTINGS, ollama, SINGLE_RUN_IMAGES } from "./ollama.ts";
import { OpenFailure } from "./provider.ts";
import { CREATE_LEASE_MS, PodRegistry } from "./registry.ts";
import {
  adminToken,
  ofOrganization,
  type PodHandle,
  PodInference,
  type PodSettings,
  podSettingsKey,
  releasePod,
} from "./selfhosted.ts";

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
function setup(options: { real?: boolean; image?: string } = {}) {
  let now = new Date("2026-10-03T12:00:00Z");
  const gpu = new FakeGpu({ now: () => now });
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
        accountKey: "account-key",
        store,
        now: () => now,
        fetch: gateways.fetch,
        wait: (ms) => wait(ms),
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
    const opened = await provider.open({ task, runId, limit }, runtime);
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
  const opened = await provider.open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
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
    const claim = await registry.claim({ ...description, settings }, holder, "200");
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
    const claim = await registry.claim({ ...description, settings: "s8" }, "o/r#9", "100");
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
  const creating = await registry.claim({ ...description, settings: "s11" }, "o/r#12", "300");
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
  const claim = await registry.claim(description, "o/r#7", "300");
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
    const claim = await registry.claim(description, "o/r#8", "300");
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

test("a pod whose gateway does not apply the Ollama settings fails the run, and is terminated", async () => {
  const { gpu, gateways, open } = setup({ image: SHARED_IMAGE });
  gateways.state("pod1").version = GATEWAY_VERSION;
  await assert.rejects(
    open("7", "300", { ollama: { OLLAMA_NUM_PARALLEL: "4" } }),
    /Pod pod1's gateway did not apply the Ollama settings \(`OLLAMA_NUM_PARALLEL=4`\): its image cannot\./,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
});
