import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sha256 } from "../gateway/gateway.ts";
import { closeKey, openKey } from "../steps/keys.ts";
import { FakeGateways, FakeGpu } from "../testing/fake-gpu.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { ollama, POD_IMAGE, SINGLE_RUN_IMAGES } from "./ollama.ts";
import {
  adminToken,
  type PodHandle,
  PodInference,
  type PodSettings,
  podGroup,
  podOwner,
  releasePod,
} from "./selfhosted.ts";

const repository = { owner: "o", name: "r" };
const settings: PodSettings = {
  model: "qwen3-coder:30b",
  engine: ollama,
  taskSpent: 0,
  pods: [],
  gpuType: "GPU-A",
  image: "ghcr.io/o/codeman-pod@sha256:1",
  reuse: "task",
};
const noWait = async () => undefined;

function setup(overrides: Partial<PodSettings> = {}) {
  let now = new Date("2026-10-03T12:00:00Z");
  const gpu = new FakeGpu({ now: () => now });
  const gateways = new FakeGateways(gpu);
  const make = (more: Partial<PodSettings> = {}) =>
    new PodInference(
      { ...settings, ...overrides, ...more },
      {
        repository,
        gpu,
        accountKey: "account-key",
        now: () => now,
        fetch: gateways.fetch,
        wait: noWait,
      },
    );
  return {
    gpu,
    gateways,
    make,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

test("a run creates a pod that serves the model, and gives the agent a token for its gateway", async () => {
  const { gpu, gateways, make } = setup();
  const runtime = new FakeRuntime();
  const opened = await make().open({ task: "7", runId: "300", limit: 1.5 }, runtime);
  const spec = gpu.created[0];
  assert.equal(spec?.gpuType, "GPU-A");
  assert.equal(spec?.image, settings.image);
  assert.equal(spec?.port, 8080);
  assert.equal(spec?.env.CODEMAN_REPOSITORY, "o/r");
  assert.equal(spec?.env.CODEMAN_TASK, "7");
  assert.equal(spec?.env.CODEMAN_MODEL, "qwen3-coder:30b");
  assert.equal(spec?.env.CODEMAN_START_BY, "2026-10-03T12:25:00.000Z");
  const nonce = spec?.env.CODEMAN_NONCE ?? "";
  assert.equal(spec?.env.CODEMAN_ADMIN_SHA256, sha256(adminToken("account-key", nonce)));
  assert.ok(!JSON.stringify(spec?.env).includes("account-key"));

  const handle = JSON.parse(opened.handle) as PodHandle;
  assert.equal(handle.podId, "pod1");
  assert.equal(handle.start, Date.parse("2026-10-03T12:00:00Z"), "billing starts with the pod");
  assert.equal(opened.baseUrl, "https://pod1-8080.pods.test/v1");
  assert.equal(opened.contextLength, 65536);
  const run = gateways.state("pod1").run;
  assert.equal(run?.tokenSha256, sha256(opened.credential));
  assert.equal(run?.limit, 1.5);
  assert.equal(run?.pricePerSecond, 0.0002);
  assert.ok(!opened.handle.includes(opened.credential));
});

test("close reads the run's usage, costs its time, and keeps the pod for the task", async () => {
  const { gpu, make, advance } = setup();
  const provider = make();
  const opened = await provider.open({ task: "7", runId: "300", limit: 1.5 }, new FakeRuntime());
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

  await releasePod(gpu.pods, opened.handle, new FakeRuntime());
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("the task's next run reuses its kept pod, with a new token and its own start", async () => {
  const { gpu, gateways, make, advance } = setup();
  const provider = make();
  const first = await provider.open({ task: "7", runId: "300", limit: 1.5 }, new FakeRuntime());
  advance(10 * 60_000);
  await provider.close(first.handle, new FakeRuntime());
  advance(2 * 60_000);
  const second = await make().open({ task: "7", runId: "301", limit: 1.1 }, new FakeRuntime());
  assert.equal(gpu.created.length, 1, "no new pod");
  const handle = JSON.parse(second.handle) as PodHandle;
  assert.equal(handle.podId, "pod1");
  assert.equal(handle.start, Date.parse("2026-10-03T12:12:00Z"));
  assert.notEqual(second.credential, first.credential);
  assert.equal(gateways.state("pod1").run?.tokenSha256, sha256(second.credential));
});

test("a model change replaces the task's kept pod", async () => {
  const { gpu, make } = setup();
  const first = make();
  const opened = await first.open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
  await first.close(opened.handle, new FakeRuntime());
  const other = await make({ model: "llama3.2" }).open(
    { task: "7", runId: "301", limit: 1 },
    new FakeRuntime(),
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
  assert.equal((JSON.parse(other.handle) as PodHandle).podId, "pod2");
});

test("with one pod per run, close terminates it", async () => {
  const { gpu, make } = setup({ reuse: "run" });
  const provider = make();
  const opened = await provider.open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
  const usage = await provider.close(opened.handle, new FakeRuntime());
  assert.equal(usage.keptPod, undefined);
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a close whose pod does not answer still costs the run's time and terminates the pod", async () => {
  const { gpu, gateways, make, advance } = setup();
  const provider = make();
  const opened = await provider.open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
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

test("open terminates the repository's pods that lost their run or their usefulness", async () => {
  const { gpu, gateways, make, advance } = setup();
  const spec = { image: settings.image, port: 8080, gpuType: "GPU-A", diskGb: 1, name: "n" };
  const env = (task: string, nonce: string) => ({
    ...podOwner(repository),
    CODEMAN_TASK: task,
    CODEMAN_NONCE: nonce,
    CODEMAN_MODEL: settings.model,
    CODEMAN_ADMIN_SHA256: sha256(adminToken("account-key", nonce)),
  });
  // pod1: still serving a run that died; pod2: kept for task 8, idle too long; pod3: kept for
  // task 9, recently; pod4: unreachable; pod5: another repository's.
  for (const [task, nonce] of [
    ["7", "a"],
    ["8", "b"],
    ["9", "c"],
    ["10", "d"],
  ]) {
    await gpu.pods.create({ ...spec, env: env(task as string, nonce as string) });
  }
  await gpu.pods.create({ ...spec, env: { CODEMAN_REPOSITORY: "o/other" } });
  gateways.state("pod1").serving = true;
  gateways.state("pod2").lastActivity = gpu.now().getTime() - 20 * 60_000;
  gateways.state("pod3").lastActivity = gpu.now().getTime() - 5 * 60_000;
  gateways.state("pod4").reachable = false;
  advance(1_000);
  await make().open({ task: "11", runId: "300", limit: 1 }, new FakeRuntime());
  assert.deepEqual(gpu.terminated, ["pod1", "pod2", "pod4"]);
  assert.ok(gpu.live.has("pod3") && gpu.live.has("pod5"));
});

test("open leaves the pods of the run's other tasks to their own jobs", async () => {
  const { gpu, gateways, make, advance } = setup({ others: ["8"] });
  const spec = { image: settings.image, port: 8080, gpuType: "GPU-A", diskGb: 1, name: "n" };
  for (const [task, nonce] of [
    ["8", "a"],
    ["9", "b"],
  ]) {
    await gpu.pods.create({
      ...spec,
      env: {
        ...podOwner(repository),
        CODEMAN_TASK: task as string,
        CODEMAN_NONCE: nonce as string,
        CODEMAN_MODEL: settings.model,
        CODEMAN_ADMIN_SHA256: sha256(adminToken("account-key", nonce as string)),
      },
    });
  }
  // Both serve a run: task 8's in this run, task 9's lost.
  gateways.state("pod1").serving = true;
  gateways.state("pod2").serving = true;
  advance(1_000);
  await make().open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
  assert.deepEqual(gpu.terminated, ["pod2"]);
  assert.ok(gpu.live.has("pod1"));
});

test("a pod that never serves the model is terminated, and the run does not open", async () => {
  const { gpu, gateways, make } = setup();
  gateways.state("pod1").ready = false;
  await assert.rejects(
    make().open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime()),
    /not ready within 25 minutes/,
  );
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a run that would pass the month's budget creates no pod", async () => {
  const { gpu, gateways, make } = setup({ taskSpent: 0.5 });
  gpu.month = 19.5;
  const runtime = new FakeRuntime({
    inputs: {
      "encryption-secret": "s".repeat(32),
      task: "7",
      "task-budget": "2",
      "monthly-budget": "20",
    },
  });
  await openKey(fakeServices(new FakePlatform(), runtime, undefined, make()));
  assert.equal(runtime.outputs.status, "over-budget");
  assert.equal(runtime.outputs["task-spent"], "0.5000");
  assert.equal(gpu.created.length, 0);
  assert.equal(gateways.calls.length, 0);
});

test("close-key reports the pod, its billing and whether it was kept", async () => {
  const { gpu, make } = setup({ pods: ["old"] });
  const provider = make();
  const opened = await provider.open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
  gpu.billed.old = 0.42;
  const runtime = new FakeRuntime({ inputs: { handle: opened.handle } });
  await closeKey(fakeServices(new FakePlatform(), runtime, undefined, provider));
  assert.equal(runtime.outputs.pod, "pod1");
  assert.equal(runtime.outputs["kept-pod"], "pod1");
  assert.equal(runtime.outputs["pod-costs"], '{"old":0.42,"pod1":0}');
  assert.equal(runtime.outputs["input-tokens"], "3000");
});

test("a kept pod's time between runs counts in its cost, before Runpod bills it", async () => {
  const { make, advance } = setup();
  const first = make();
  const opened = await first.open({ task: "7", runId: "300", limit: 1.5 }, new FakeRuntime());
  advance(10 * 60_000);
  await first.close(opened.handle, new FakeRuntime());
  advance(2 * 60_000);
  const second = make();
  const reused = await second.open({ task: "7", runId: "301", limit: 1.1 }, new FakeRuntime());
  assert.equal(
    (JSON.parse(reused.handle) as PodHandle).created,
    Date.parse("2026-10-03T12:00:00Z"),
  );
  advance(5 * 60_000);
  const usage = await second.close(reused.handle, new FakeRuntime());
  assert.ok(Math.abs(usage.cost - 0.06) < 1e-9, "the run: 5 minutes");
  assert.equal(usage.podCosts?.pod1, 0.204, "the pod: 17 minutes, 2 of them between runs");
});

test("the month counts the account's live pods beyond what they were billed", async () => {
  const { gpu, make, advance } = setup();
  gpu.month = 1;
  const spec = { name: "n", image: "i", env: {}, port: 8080, gpuType: "GPU-A", diskGb: 1 };
  await gpu.pods.create(spec);
  await gpu.pods.create(spec);
  advance(30 * 60_000);
  gpu.billed.pod1 = 0.1;
  gpu.billed.pod2 = 0.5;
  // pod1: 30 minutes at US$ 0.72 per hour, US$ 0.36, of which 0.10 billed; pod2: billed above.
  assert.ok(Math.abs((await make().monthSpent()) - 1.26) < 1e-9);
});

/** Runs of a workflow run whose tasks share pods, served by Codeman's own gateway. */
function setupShared(options: { real?: boolean } = {}) {
  let now = new Date("2026-10-03T12:00:00Z");
  const gpu = new FakeGpu({ now: () => now });
  const gateways = new FakeGateways(gpu, { real: options.real ?? true });
  after(() => gateways.close());
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  let wait: (ms: number) => Promise<void> = noWait;
  const leg = (task: string, others: string[], more: Partial<PodSettings> = {}) => {
    const provider = new PodInference(
      { ...settings, share: true, others, ...more },
      {
        repository,
        gpu,
        accountKey: "account-key",
        now: () => now,
        fetch: gateways.fetch,
        wait: (ms) => wait(ms),
      },
    );
    return {
      provider,
      open: async (runId: string, limit = 1) => {
        const runtime = new FakeRuntime();
        const opened = await provider.open({ task, runId, limit }, runtime);
        return { opened, handle: JSON.parse(opened.handle) as PodHandle, runtime };
      },
    };
  };
  const release = (handle: string) =>
    releasePod(gpu.pods, handle, new FakeRuntime(), {
      accountKey: "account-key",
      fetch: gateways.fetch,
    });
  return {
    gpu,
    gateways,
    leg,
    advance,
    release,
    setWait: (next: (ms: number) => Promise<void>) => {
      wait = next;
    },
  };
}

const near = (actual: number | undefined, expected: number) =>
  assert.ok(Math.abs((actual ?? Number.NaN) - expected) < 1e-9, `${actual} is not ${expected}`);

test("two tasks of a run share one pod: the first creates it, the other attaches, and each pays its share", async () => {
  const { gpu, gateways, leg, advance, release } = setupShared();
  const seven = leg("7", ["8"]);
  const eight = leg("8", ["7"]);
  const a = await seven.open("300");
  const b = await eight.open("300");
  assert.equal(gpu.created.length, 1);
  assert.equal(gpu.created[0]?.env.CODEMAN_GROUP, podGroup("300", settings));
  assert.equal(a.handle.podId, "pod1");
  assert.equal(b.handle.podId, "pod1");
  assert.deepEqual(a.handle.shared?.task, "7");
  assert.equal(b.handle.shared?.tokenSha256, sha256(b.opened.credential));
  assert.notEqual(a.opened.credential, b.opened.credential);
  assert.match(b.runtime.logged("info").join("\n"), /Sharing pod pod1, already serving/);
  assert.deepEqual(gateways.gateway("pod1")?.status().active, ["7", "8"]);

  // Ten minutes on the pod, US$ 0.12, of which each run pays half; then task 8 alone.
  advance(10 * 60_000);
  const runtime = new FakeRuntime({ inputs: { handle: a.opened.handle } });
  await closeKey(fakeServices(new FakePlatform(), runtime, undefined, seven.provider));
  assert.equal(runtime.outputs["run-cost"], "0.0600");
  assert.equal(runtime.outputs["pod-shared"], "true");
  assert.equal(runtime.outputs["pod-costs"], '{"pod1":0.06}');
  assert.equal(runtime.outputs["kept-pod"], "pod1");
  advance(10 * 60_000);
  const second = await eight.provider.close(b.opened.handle, new FakeRuntime());
  near(second.cost, 0.18);
  assert.deepEqual(second.podCosts, { pod1: 0.18 }, "the shares add up to the pod's 20 minutes");
  assert.ok(gpu.live.has("pod1"), "both tasks keep it");

  // Task 7 does not go on: the pod stays for task 8, until it does not either.
  await release(a.opened.handle);
  assert.ok(gpu.live.has("pod1"));
  await release(b.opened.handle);
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a task that waited for the shared pod's start shares it, and two pods created at once end as one", async () => {
  const { gpu, gateways, leg, advance, setWait } = setupShared();
  const group = podGroup("300", settings);
  // Task 7's leg creates its pod a second before task 8's, after task 8 looked.
  const create = gpu.pods.create;
  gpu.pods.create = async (spec) => {
    const nonce = "n7";
    const rival = await create({
      ...spec,
      env: {
        ...spec.env,
        CODEMAN_TASK: "7",
        CODEMAN_NONCE: nonce,
        CODEMAN_ADMIN_SHA256: sha256(adminToken("account-key", nonce)),
      },
    });
    gateways.state(rival.id).ready = false;
    gpu.pods.create = create;
    advance(1_000);
    return create(spec);
  };
  setWait(async () => {
    gateways.state("pod1").ready = true;
    advance(60_000);
  });
  const b = await leg("8", ["7"]).open("300");
  assert.deepEqual(
    gpu.created.map((spec) => spec.env.CODEMAN_GROUP),
    [group, group],
  );
  assert.deepEqual(gpu.terminated, ["pod2"], "the later pod");
  assert.equal(b.handle.podId, "pod1");
  // It looked, waited its turn (a minute here), and created; it then waited for pod 1's start.
  assert.equal(b.handle.start, Date.parse("2026-10-03T12:01:00Z"), "its share starts with the pod");
  assert.equal(gpu.live.get("pod1")?.createdAt.getTime(), b.handle.start);
  assert.match(b.runtime.logged("info").join("\n"), /created pod pod1 first/);
});

test("the next run's tasks share the pod they kept, and the time between runs goes to its keepers", async () => {
  const { gpu, leg, advance } = setupShared();
  const first = [await leg("7", ["8"]).open("300"), await leg("8", ["7"]).open("300")];
  advance(10 * 60_000);
  for (const [index, run] of first.entries()) {
    await leg(index === 0 ? "7" : "8", []).provider.close(run.opened.handle, new FakeRuntime());
  }
  // Both keep the pod for ten minutes, then the next run takes them both on.
  advance(10 * 60_000);
  const seven = leg("7", ["8"]);
  const a = await seven.open("301");
  const b = await leg("8", ["7"]).open("301");
  assert.equal(gpu.created.length, 1, "no new pod");
  assert.equal(a.handle.podId, "pod1");
  assert.equal(b.handle.podId, "pod1");
  assert.equal(a.handle.start, Date.parse("2026-10-03T12:20:00Z"));
  assert.match(a.runtime.logged("info").join("\n"), /Sharing pod pod1, already serving/);
  advance(10 * 60_000);
  const usage = await seven.provider.close(a.opened.handle, new FakeRuntime());
  near(usage.cost, 0.06);
  // Task 7: half of each run's ten minutes, and half of the ten kept between them.
  near(usage.podCosts?.pod1, 0.18);
});

test("with one pod per run, the last task to leave a shared pod terminates it", async () => {
  const { gpu, leg } = setupShared();
  const seven = leg("7", ["8"], { reuse: "run" });
  const eight = leg("8", ["7"], { reuse: "run" });
  const a = await seven.open("300");
  const b = await eight.open("300");
  const runtime = new FakeRuntime();
  const left = await seven.provider.close(a.opened.handle, runtime);
  assert.equal(left.keptPod, undefined);
  assert.match(
    runtime.logged("info")[0] ?? "",
    /Left pod pod1 to the tasks that still use or keep it \(#8\)/,
  );
  assert.deepEqual(gpu.terminated, []);
  await eight.provider.close(b.opened.handle, new FakeRuntime());
  assert.deepEqual(gpu.terminated, ["pod1"]);
});

test("a gateway that serves one run at a time gives each task of the run a pod of its own", async () => {
  const { gpu, leg } = setupShared({ real: false });
  const a = await leg("7", ["8"]).open("300");
  const b = await leg("8", ["7"]).open("300");
  assert.equal(a.handle.podId, "pod1");
  assert.equal(a.handle.shared, undefined, "the pod it created serves its task alone");
  assert.equal(b.handle.podId, "pod2");
  assert.equal(b.handle.shared, undefined);
  assert.equal(gpu.created[1]?.env.CODEMAN_GROUP, undefined);
  assert.match(b.runtime.logged("info").join("\n"), /serves one run at a time.*\n.*pod of its own/);
});

test("the image pinned before shared pods gives each task a pod of its own at once", async () => {
  const [old] = [...SINGLE_RUN_IMAGES];
  assert.ok(old && old !== "", "an image is listed");
  assert.ok(!SINGLE_RUN_IMAGES.has(POD_IMAGE) || old === POD_IMAGE);
  const { gpu, leg } = setupShared();
  const a = await leg("7", ["8"], { image: old }).open("300");
  const b = await leg("8", ["7"], { image: old }).open("300");
  assert.deepEqual([a.handle.podId, b.handle.podId], ["pod1", "pod2"]);
  assert.equal(gpu.created[0]?.env.CODEMAN_GROUP, undefined);
  assert.match(a.runtime.logged("info")[0] ?? "", /serves one run at a time/);
});

test("a task that cannot reach its run's shared pod creates another for the run", async () => {
  const { gpu, gateways, leg, advance } = setupShared();
  await leg("7", ["8"]).open("300");
  // Task 8's job starts late, and the pod no longer answers.
  advance(30 * 60_000);
  gateways.state("pod1").reachable = false;
  const b = await leg("8", ["7"]).open("300");
  assert.equal(b.handle.podId, "pod2");
  assert.equal(gpu.created[1]?.env.CODEMAN_GROUP, podGroup("300", settings));
  assert.match(b.runtime.logged("warning")[0] ?? "", /Could not share pod pod1/);
});
