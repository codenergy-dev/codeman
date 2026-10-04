import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSettings, type Settings } from "../settings.ts";
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
  assert.deepEqual(openrouter, { inference: "openrouter" });
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
    taskSpent: 0.75,
    pods: ["p1"],
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
    taskSpent: 0,
    pods: [],
    mode: "serverless",
    endpoint: "ep1",
  });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(pod)), pod);
});

test("an empty choice, from older workflow files, is OpenRouter; anything else must be whole", () => {
  assert.deepEqual(parseInferenceChoice(""), { inference: "openrouter" });
  assert.throws(
    () => parseInferenceChoice('{"inference":"self-hosted","model":"m"}'),
    /not a valid/,
  );
});

test("builds the provider the choice names, with only the credentials it needs", () => {
  const openrouter = new FakeRuntime({ inputs: { "management-key": "mk" } });
  assert.equal(inferenceProvider(openrouter).name, "openrouter");
  const choice = inferenceChoice(
    settings({ inference: "self-hosted", model: "qwen3-coder:30b", "gpu-type": "GPU A" }),
    null,
  );
  const pod = new FakeRuntime({ inputs: { inference: JSON.stringify(choice), "gpu-key": "rk" } });
  assert.equal(inferenceProvider(pod).name, "runpod pods");
  const missing = new FakeRuntime({ inputs: { inference: JSON.stringify(choice) } });
  assert.throws(() => inferenceProvider(missing), /gpu-key/);
});
