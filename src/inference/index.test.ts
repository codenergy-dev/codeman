import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSettings, type Settings } from "../settings.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeGateways, FakeGpu } from "../testing/fake-gpu.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { POD_IMAGES } from "./images.ts";
import {
  choicePool,
  inferenceChoice,
  inferenceProvider,
  parseInferenceChoice,
  selfHosted,
} from "./index.ts";

/** The settings of a repository's file that sets `layer`. */
function settings(layer: Partial<Settings>): Settings {
  const resolved = resolveSettings({}, {}, layer);
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.value;
}

const record = { spent: 0.75, inference: { pods: [{ id: "p1", runs: ["1"], counted: 0.75 }] } };

test("hands the key jobs the task's choice of inference, with its spend and pods", () => {
  const openrouter = inferenceChoice(settings({ model: "a/b" }), record);
  assert.deepEqual(openrouter, {
    provider: "openrouter",
    accounts: ["openrouter"],
    recorded: { spent: 0.75 },
  });

  const pod = inferenceChoice(
    settings({
      provider: "runpod-pod",
      model: "qwen3-coder:30b",
      gpu: "GPU A",
      "pod-reuse": "run",
    }),
    record,
  );
  assert.deepEqual(pod, {
    provider: "runpod-pod",
    engine: "ollama",
    model: "qwen3-coder:30b",
    pods: ["p1"],
    accounts: ["runpod"],
    recorded: { spent: 0.75 },
    gpu: "GPU A",
    podReuse: "run",
  });

  const serverless = inferenceChoice(
    settings({ provider: "runpod-serverless", endpoint: "ep1", model: "org/model" }),
    null,
  );
  assert.deepEqual(serverless, {
    provider: "runpod-serverless",
    engine: "vllm",
    model: "org/model",
    pods: [],
    accounts: ["runpod"],
    recorded: { spent: 0 },
    endpoint: "ep1",
  });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(pod)), pod);
});

test("a choice must be whole", () => {
  const choice = inferenceChoice(settings({ model: "a/b" }), null);
  for (const bad of [{ recorded: {} }, { accounts: [""] }, { profile: 4 }, { provider: "pod" }]) {
    assert.throws(
      () => parseInferenceChoice(JSON.stringify({ ...choice, ...bad })),
      /not a valid/,
      JSON.stringify(bad),
    );
  }
});

test("the billing of shared pods is not read as the task's", () => {
  const shared = {
    spent: 0.75,
    inference: {
      pods: [
        { id: "p1", runs: ["1"], counted: 0.5 },
        { id: "p2", runs: ["2"], counted: 0.25, shared: true },
      ],
    },
  };
  const pod = { provider: "runpod-pod" as const, model: "qwen3-coder:30b", gpu: "GPU A" };
  const choice = inferenceChoice(settings(pod), shared);
  assert.equal(choice.provider === "runpod-pod" && choice.pods.join(), "p1");
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
});

test("an empty choice, from older workflow files, is OpenRouter; anything else must be whole", () => {
  assert.deepEqual(parseInferenceChoice(""), {
    provider: "openrouter",
    accounts: ["openrouter"],
    recorded: { spent: 0 },
  });
  assert.throws(() => parseInferenceChoice('{"provider":"runpod-pod","model":"m"}'), /not a valid/);
});

test("builds the provider the choice names, with only the credentials it needs", () => {
  const openrouter = new FakeRuntime({ inputs: { "management-key": "mk" } });
  const store = () => new MemoryStore();
  assert.equal(inferenceProvider(openrouter, store).name, "openrouter");
  const choice = inferenceChoice(
    settings({ provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "GPU A" }),
    null,
  );
  const pod = new FakeRuntime({ inputs: { inference: JSON.stringify(choice), "gpu-key": "rk" } });
  assert.equal(inferenceProvider(pod, store).name, "runpod pods");
  const missing = new FakeRuntime({ inputs: { inference: JSON.stringify(choice) } });
  assert.throws(() => inferenceProvider(missing, store), /gpu-key/);
});

test("a pod's choice carries its Ollama settings, checked again when read", () => {
  const choice = inferenceChoice(
    settings({
      provider: "runpod-pod",
      model: "qwen3-coder:30b",
      gpu: "GPU A",
      ollama: { "num-parallel": "4" },
    }),
    null,
  );
  assert.deepEqual(choice.provider === "runpod-pod" && choice.ollama, { "num-parallel": "4" });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
  const none = inferenceChoice(
    settings({ provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "GPU A" }),
    null,
  );
  assert.equal("ollama" in none, false, "none without settings");
  for (const ollama of [{ host: "0.0.0.0" }, { "num-parallel": 4 }, ["num-parallel"], "x"]) {
    assert.throws(
      () => parseInferenceChoice(JSON.stringify({ ...choice, ollama })),
      /not a valid|cannot set/,
      JSON.stringify(ollama),
    );
  }
});

test("a vLLM pod's choice carries its vLLM settings, checked again when read", () => {
  const choice = inferenceChoice(
    settings({
      provider: "runpod-pod",
      engine: "vllm",
      model: "unsloth/Qwen3.8-27B-NVFP4",
      gpu: "GPU A",
      vllm: { "tool-call-parser": "qwen3_xml", "kv-cache-dtype": "fp8" },
    }),
    null,
    { parallel: 4 },
  );
  assert.equal(choice.provider === "runpod-pod" && choice.engine, "vllm");
  assert.deepEqual(choice.provider === "runpod-pod" && choice.vllm, {
    "tool-call-parser": "qwen3_xml",
    "kv-cache-dtype": "fp8",
  });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
  for (const vllm of [
    { host: "0.0.0.0" },
    { "max-num-seqs": 4 },
    { "speculative-method": "mtp" },
    ["tool-call-parser"],
  ]) {
    assert.throws(
      () => parseInferenceChoice(JSON.stringify({ ...choice, vllm })),
      /not a valid|cannot set|needs/,
      JSON.stringify(vllm),
    );
  }
});

test("a pod's choice carries the most tasks its profile serves, for num-parallel", () => {
  const pod = settings({ provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "GPU A" });
  const choice = inferenceChoice(pod, null, { profile: "parallel-tasks", parallel: 4 });
  assert.equal(choice.provider === "runpod-pod" && choice.parallel, 4);
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
  const openrouter = inferenceChoice(settings({ model: "a/b" }), null, { parallel: 4 });
  assert.equal("parallel" in openrouter, false, "only pods take it");
  for (const parallel of [0, 11, 2.5, "4"]) {
    assert.throws(
      () => parseInferenceChoice(JSON.stringify({ ...choice, parallel })),
      /not a valid/,
      JSON.stringify(parallel),
    );
  }
});

test("a choice carries the pool its organization agrees on, and a pod's its batch", () => {
  const pod = settings({ provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "GPU A" });
  const pool = { id: "a+b", members: ["a", "b"] };
  const choice = inferenceChoice(pod, null, { pool, batch: "300-1-0" });
  assert.deepEqual(choice.pool, pool);
  assert.equal(choice.provider === "runpod-pod" && choice.batch, "300-1-0");
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
  assert.deepEqual(choicePool(choice, "B"), pool);
  assert.throws(() => choicePool(choice, "c"), /pool a\+b, without c/);
  // Older choices name no pool: the organization alone.
  const older = inferenceChoice(settings({ model: "a/b" }), null);
  assert.equal("pool" in older, false);
  assert.deepEqual(choicePool(older, "A"), { id: "a", members: ["a"] });
  const openrouter = inferenceChoice(settings({ model: "a/b" }), null, { pool, batch: "1-1-1" });
  assert.equal("batch" in openrouter, false, "only pods take a batch");
  for (const wrong of [
    { pool: { id: "b+a", members: ["a"] } },
    { pool: { id: "a+b", members: ["c"] } },
    { pool: { id: "a+b", members: [] } },
    { pool: { id: "a+b", members: ["A"] } },
    { pool: "a+b" },
    { batch: "x" },
    { batch: 3 },
  ]) {
    assert.throws(
      () => parseInferenceChoice(JSON.stringify({ ...choice, ...wrong })),
      /not a valid/,
      JSON.stringify(wrong),
    );
  }
});

test("a vLLM pod's choice reaches its pod: the vLLM image, its settings and max-num-seqs", async () => {
  const choice = inferenceChoice(
    settings({
      provider: "runpod-pod",
      engine: "vllm",
      model: "unsloth/Qwen3.8-27B-NVFP4",
      gpu: "GPU-A",
      vllm: { "tool-call-parser": "qwen3_xml" },
    }),
    null,
    { parallel: 3 },
  );
  if (choice.provider !== "runpod-pod") throw new Error("a pod's choice");
  const gpu = new FakeGpu();
  const gateways = new FakeGateways(gpu, { real: true });
  try {
    const provider = selfHosted(
      choice,
      { owner: "o", name: "r" },
      {
        accountKey: "k",
        image: "ghcr.io/o/codeman-vllm@sha256:2",
        usage: "",
        store: () => new MemoryStore(),
        gpu,
        fetch: gateways.fetch,
        hub: { model: async (id) => ({ id, weightsBytes: 1e9 }) },
      },
    );
    await provider.open({ task: "7", runId: "300", limit: 1 }, new FakeRuntime());
    assert.equal(
      gpu.created[0]?.env.CODEMAN_VLLM,
      '{"max-num-seqs":"3","tool-call-parser":"qwen3_xml"}',
    );
    assert.equal(gpu.created[0]?.env.CODEMAN_ENGINE, "vllm");
  } finally {
    gateways.close();
  }
  // The `pod-image` input is Ollama's: a vLLM run takes the pinned vLLM image, or none yet.
  const runtime = new FakeRuntime({
    inputs: { inference: JSON.stringify(choice), "gpu-key": "rk", "pod-image": "x@sha256:1" },
  });
  if (POD_IMAGES.vllm === "") {
    await assert.rejects(
      inferenceProvider(runtime, () => new MemoryStore()).open(
        { task: "7", runId: "300", limit: 1 },
        new FakeRuntime(),
      ),
      /pins no vLLM pod image yet/,
    );
  }
});
