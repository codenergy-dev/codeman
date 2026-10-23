import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { POD_IMAGES } from "../../src/inference/images.ts";
import { httpLauncher, isFailure, type LaunchSpec } from "../fakes/runpod/launcher.ts";
import { allowlistPlan, Launcher, type PodPlan, teeEnv } from "./launcher.ts";

/** The launcher behind its token, with a runner that records instead of calling Docker. */

const TOKEN = "unit-launcher-token";
const ran: { spec: LaunchSpec; plan: PodPlan; labels: Record<string, string> }[] = [];
const stopped: string[] = [];
const stopping: string[] = [];
const launcher = new Launcher({
  token: TOKEN,
  plan: (spec) => allowlistPlan(spec, { model: "http://llm:8080", controlToken: "control" }),
  labels: () => ({ "codeman-e2e.scenario": "unit" }),
  run: async (spec, plan, labels) => {
    ran.push({ spec, plan, labels });
    return `codeman-e2e-pod-${spec.id}`;
  },
  stop: async (id) => {
    stopped.push(id);
  },
  stopping: async (id) => {
    // Before the container goes, and its failure does not keep it.
    assert.ok(!stopped.includes(id));
    stopping.push(id);
    throw new Error("The engine did not answer.");
  },
});
let base = "";

before(async () => {
  base = `http://127.0.0.1:${await launcher.listen()}`;
});
after(() => launcher.close());

function spec(image: string, id = "pod1"): LaunchSpec {
  return {
    id,
    name: "codeman-pod",
    image,
    env: { CODEMAN_MODEL: "qwen2.5:0.5b", CODEMAN_ADMIN_SHA256: "a".repeat(64) },
    ports: [{ port: 8080, protocol: "http" }],
    gpu: { id: "NVIDIA RTX A4000", count: 1, memoryGb: 16 },
    cloud: "SECURE",
    diskGb: 20,
    cudaVersion: "12.8",
  };
}

test("a pinned pod image runs as its local e2e image, with its model volume", async () => {
  const result = await httpLauncher(base, { token: TOKEN }).launch(
    spec(POD_IMAGES.ollama as string),
  );
  assert.ok(!isFailure(result));
  assert.equal(result.urlForPort(8080), "http://codeman-e2e-pod-pod1:8080");
  const [launched] = ran;
  assert.equal(launched?.plan.image, "codeman-e2e-pod-ollama:local");
  assert.ok(launched?.plan.volumes.includes("codeman-e2e-ollama:/root/.ollama/models:ro"));
  assert.equal(launched?.plan.env.TEE_MODEL, "http://llm:8080");
  assert.equal(launched?.plan.shm, undefined);
  // The pod's own environment goes as the create request sent it, apart from the plan's.
  assert.equal(launched?.spec.env.CODEMAN_MODEL, "qwen2.5:0.5b");
  assert.deepEqual(launched?.labels, { "codeman-e2e.scenario": "unit", "codeman-e2e.pod": "pod1" });

  await httpLauncher(base, { token: TOKEN }).terminate("pod1");
  assert.deepEqual(stopping, ["pod1"]);
  assert.deepEqual(stopped, ["pod1"]);
});

test("any other image is refused, and no container starts", async () => {
  const before = ran.length;
  const repository = (POD_IMAGES.ollama as string).split("@")[0] as string;
  for (const image of [`${repository}:latest`, repository, "ollama/ollama:0.35.1", "alpine"]) {
    const result = await httpLauncher(base, { token: TOKEN }).launch(spec(image, "pod2"));
    assert.ok(isFailure(result), image);
    assert.match(result.failure, /403: No e2e pod image stands in for/);
  }
  assert.equal(ran.length, before);
});

test("the launcher needs its token", async () => {
  const before = ran.length;
  const result = await httpLauncher(base, { token: "wrong" }).launch(
    spec(POD_IMAGES.vllm as string),
  );
  assert.ok(isFailure(result));
  assert.match(result.failure, /401/);
  const anonymous = await fetch(`${base}/pods/pod1`, { method: "DELETE" });
  assert.equal(anonymous.status, 401);
  assert.equal(ran.length, before);
});

test("terminating a pod it never started answers 404, which the fake takes as gone", async () => {
  const response = await fetch(`${base}/pods/unknown`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(response.status, 404);
  await httpLauncher(base, { token: TOKEN }).terminate("unknown");
});

test("a pod ID that is not a plain name is refused", async () => {
  const result = await httpLauncher(base, { token: TOKEN }).launch(
    spec(POD_IMAGES.ollama as string, "../x"),
  );
  assert.ok(isFailure(result));
  assert.match(result.failure, /400/);
});

test("a vLLM pod gets its model's cache and 1 GiB of shared memory, which vLLM's CPU engine needs", async () => {
  const plan = await allowlistPlan(spec(POD_IMAGES.vllm as string, "pod9"), {
    model: "http://llm:8080",
    controlToken: "control",
  });
  assert.equal(plan.image, "codeman-e2e-pod-vllm:local");
  assert.ok(plan.volumes.includes("codeman-e2e-hf:/root/.cache/huggingface:ro"));
  assert.equal(plan.shm, "1g");
});

test("a scenario's tee options reach its pods' environment, and the tee's own variables win", async () => {
  const env = teeEnv({ meet: { issues: 2, timeoutMs: 90_000 } });
  assert.deepEqual(env, { TEE_MEET_ISSUES: "2", TEE_MEET_TIMEOUT_MS: "90000" });
  assert.deepEqual(teeEnv(undefined), {});
  const plan = await allowlistPlan(spec(POD_IMAGES.ollama as string, "pod8"), {
    model: "http://llm:8080",
    controlToken: "control",
    env: { ...env, TEE_MODEL: "http://elsewhere" },
  });
  assert.deepEqual(plan.env, {
    TEE_MEET_ISSUES: "2",
    TEE_MEET_TIMEOUT_MS: "90000",
    TEE_MODEL: "http://llm:8080",
    FAKE_CONTROL_TOKEN: "control",
  });
});
