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
  assert.deepEqual(openrouter, {
    inference: "openrouter",
    providers: ["openrouter"],
    recorded: { spent: 0.75, selfHosted: 0.75 },
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
    recorded: { spent: 0.75, selfHosted: 0.75 },
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
    recorded: { spent: 0, selfHosted: 0 },
    mode: "serverless",
    endpoint: "ep1",
  });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(pod)), pod);
});

test("with several tasks, a choice names the run's others and what the month keeps for them", () => {
  const choice = inferenceChoice(settings({ model: "a/b" }), null, {
    reserved: 1.5,
    others: ["4", "9"],
  });
  assert.deepEqual(choice, {
    inference: "openrouter",
    providers: ["openrouter"],
    recorded: { spent: 0, selfHosted: 0 },
    reserved: 1.5,
    others: ["4", "9"],
  });
  assert.deepEqual(parseInferenceChoice(JSON.stringify(choice)), choice);
  // One task: neither, as before parallel tasks.
  assert.deepEqual(
    inferenceChoice(settings({ model: "a/b" }), null, { reserved: 0, others: [] }),
    inferenceChoice(settings({ model: "a/b" }), null),
  );
  for (const bad of [{ reserved: -1 }, { reserved: "1" }, { others: ["../x"] }, { others: [4] }]) {
    assert.throws(
      () => parseInferenceChoice(JSON.stringify({ ...choice, ...bad })),
      /not a valid/,
      JSON.stringify(bad),
    );
  }
});

test("an empty choice, from older workflow files, is OpenRouter; anything else must be whole", () => {
  assert.deepEqual(parseInferenceChoice(""), {
    inference: "openrouter",
    providers: ["openrouter"],
    recorded: { spent: 0, selfHosted: 0 },
  });
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
