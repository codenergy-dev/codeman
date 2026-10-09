import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSettings, type Settings } from "../settings.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { inferenceChoice, inferenceProvider, parseInferenceChoice } from "./index.ts";

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
