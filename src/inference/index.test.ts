import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSettings, type Settings } from "../settings.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { agentMode, inferenceChoice, inferenceProvider, parseInferenceChoice } from "./index.ts";

function settings(layer: Partial<Settings>): Settings {
  const resolved = resolveSettings(layer);
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.value;
}

const record = { spent: 0.75, inference: { pods: [{ id: "p1", runs: ["1"], counted: 0.75 }] } };

test("hands the key jobs the task's choice of inference, with its spend and pods", () => {
  const openrouter = inferenceChoice(settings({ model: "a/b" }), record);
  assert.deepEqual(openrouter, {
    inference: "openrouter",
    providers: ["openrouter"],
    recorded: { spent: 0.75 },
  });
  assert.equal(agentMode(openrouter), "openrouter");

  const pod = inferenceChoice(
    settings({
      inference: "self-hosted",
      model: "qwen3-coder:30b",
      "gpu-type": "GPU A",
      "pod-reuse": "run",
    }),
    record,
  );
  assert.deepEqual(pod, {
    inference: "self-hosted",
    gpuProvider: "runpod",
    engine: "ollama",
    model: "qwen3-coder:30b",
    pods: ["p1"],
    providers: ["runpod"],
    recorded: { spent: 0.75 },
    mode: "pod",
    gpuType: "GPU A",
    podReuse: "run",
  });
  assert.equal(agentMode(pod), "pod");

  const serverless = inferenceChoice(
    settings({
      inference: "self-hosted",
      "gpu-mode": "serverless",
      "serverless-endpoint": "ep1",
      model: "org/model",
    }),
    null,
  );
  assert.equal(agentMode(serverless), "serverless");
  assert.deepEqual(serverless, {
    inference: "self-hosted",
    gpuProvider: "runpod",
    engine: "vllm",
    model: "org/model",
    pods: [],
    providers: ["runpod"],
    recorded: { spent: 0 },
    mode: "serverless",
    endpoint: "ep1",
  });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(pod)), pod);
});

test("a choice must be whole", () => {
  const choice = inferenceChoice(settings({ model: "a/b" }), null);
  for (const bad of [{ recorded: {} }, { providers: [""] }, { profile: 4 }]) {
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
  const pod = { inference: "self-hosted" as const, model: "qwen3-coder:30b", "gpu-type": "GPU A" };
  const choice = inferenceChoice(settings({ ...pod, "parallel-tasks": 2 }), shared);
  assert.equal(choice.inference === "self-hosted" && choice.pods.join(), "p1");
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
  assert.deepEqual(choice, inferenceChoice(settings(pod), shared), "whatever parallel-tasks says");
});

test("an empty choice, from older workflow files, is OpenRouter; anything else must be whole", () => {
  assert.deepEqual(parseInferenceChoice(""), {
    inference: "openrouter",
    providers: ["openrouter"],
    recorded: { spent: 0 },
  });
  assert.throws(
    () => parseInferenceChoice('{"inference":"self-hosted","model":"m"}'),
    /not a valid/,
  );
});

test("builds the provider the choice names, with only the credentials it needs", () => {
  const openrouter = new FakeRuntime({ inputs: { "management-key": "mk" } });
  const store = () => new MemoryStore();
  assert.equal(inferenceProvider(openrouter, store).name, "openrouter");
  const choice = inferenceChoice(
    settings({ inference: "self-hosted", model: "qwen3-coder:30b", "gpu-type": "GPU A" }),
    null,
  );
  const pod = new FakeRuntime({ inputs: { inference: JSON.stringify(choice), "gpu-key": "rk" } });
  assert.equal(inferenceProvider(pod, store).name, "runpod pods");
  const missing = new FakeRuntime({ inputs: { inference: JSON.stringify(choice) } });
  assert.throws(() => inferenceProvider(missing, store), /gpu-key/);
});
