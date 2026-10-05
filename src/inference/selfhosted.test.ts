import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../gateway/gateway.ts";
import { closeKey, openKey } from "../steps/keys.ts";
import { FakeGateways, FakeGpu } from "../testing/fake-gpu.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { ollama } from "./ollama.ts";
import {
  adminToken,
  type PodHandle,
  PodInference,
  type PodSettings,
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
