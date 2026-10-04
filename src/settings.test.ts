import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULTS,
  parseSetting,
  parseSettings,
  resolveSettings,
  TASK_SETTINGS,
} from "./settings.ts";

test("reads flat settings, with comments and quotes", () => {
  const parsed = parseSettings(
    [
      "# Codeman settings",
      "model: deepseek/deepseek-v4.1-flash # the default model",
      "",
      "task-budget: '1.5'",
      'max-runs: "4"',
      "max-file-bytes: 2048",
    ].join("\n"),
  );
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      model: "deepseek/deepseek-v4.1-flash",
      "task-budget": 1.5,
      "max-runs": 4,
      "max-file-bytes": 2048,
    },
  });
  assert.deepEqual(parseSettings(""), { ok: true, value: {} });
});

test("rejects anything outside the flat subset", () => {
  const errors = [
    "model:\n  nested: a/b",
    "unknown: 1",
    "model: a/b\nmodel: c/d",
    "task-budget: -2",
    "max-runs: 1.5",
    "max-files: many",
    "model: [a/b]",
    "model: &anchor a/b",
    "model: !!str a/b",
    "- model: a/b",
    "model: a/b\\c",
    'model: "a/b',
  ].map((text) => parseSettings(text));
  for (const result of errors) assert.equal(result.ok, false, JSON.stringify(result));
  const unknown = parseSettings("model: a/b\nsecret: x");
  assert.ok(!unknown.ok && unknown.error.includes("line 2"));
});

test("resolves commands, then inputs, then the file, then the defaults", () => {
  const resolved = resolveSettings(
    { "task-budget": 5 },
    { model: "input/model", "task-budget": 3, "max-runs": 2 },
    { model: "file/model", "monthly-budget": 50, "max-runs": 9 },
  );
  assert.deepEqual(resolved, {
    ok: true,
    value: {
      ...DEFAULTS,
      model: "input/model",
      "task-budget": 5,
      "monthly-budget": 50,
      "max-runs": 2,
    },
  });
});

test("a model is required", () => {
  const resolved = resolveSettings({}, {}, {});
  assert.ok(!resolved.ok && resolved.error.includes(".codeman/settings.yml"));
});

test("the language is auto or a language tag, and a task may set it", () => {
  assert.deepEqual(parseSetting("language", "auto"), { ok: true, value: "auto" });
  assert.deepEqual(parseSetting("language", "pt-BR"), { ok: true, value: "pt-BR" });
  assert.equal(parseSetting("language", "português").ok, false);
  assert.equal(parseSetting("language", "pt_BR").ok, false);
  assert.ok(TASK_SETTINGS.has("language"));
});

test("output limits stay within bounds", () => {
  assert.deepEqual(parseSetting("max-label-chars", "200"), { ok: true, value: 200 });
  assert.equal(parseSetting("max-label-chars", "301").ok, false);
  assert.equal(parseSetting("max-options", "1").ok, false);
  assert.equal(parseSetting("max-decisions", "11").ok, false);
  assert.ok(!TASK_SETTINGS.has("max-label-chars"));
  const parsed = parseSettings("max-summary-chars: 5000");
  assert.ok(!parsed.ok && parsed.error.includes("from 1 to 4000"));
});

test("OpenRouter is the default inference, and takes only OpenRouter model IDs", () => {
  const resolved = resolveSettings({}, {}, { model: "deepseek/deepseek-v4.1-flash" });
  assert.ok(resolved.ok && resolved.value.inference === "openrouter");
  assert.ok(resolved.ok && resolved.value.engine === undefined);
  const ollamaName = resolveSettings({}, {}, { model: "qwen3-coder:30b" });
  assert.ok(!ollamaName.ok && ollamaName.error.includes("OpenRouter model ID"));
});

test("self-hosted pods need a GPU type, serve Ollama models, and keep the pod for the task", () => {
  const file = parseSettings(
    'inference: self-hosted\nmodel: qwen3-coder:30b\ngpu-type: "NVIDIA RTX A6000"',
  );
  assert.ok(file.ok);
  const resolved = resolveSettings({}, {}, file.ok ? file.value : {});
  assert.ok(resolved.ok);
  if (!resolved.ok) return;
  assert.equal(resolved.value["gpu-provider"], "runpod");
  assert.equal(resolved.value["gpu-mode"], "pod");
  assert.equal(resolved.value["gpu-type"], "NVIDIA RTX A6000");
  assert.equal(resolved.value.engine, "ollama");
  assert.equal(resolved.value["pod-reuse"], "task");

  const noGpu = resolveSettings({}, {}, { inference: "self-hosted", model: "qwen3-coder:30b" });
  assert.ok(!noGpu.ok && noGpu.error.includes("gpu-type"));
  const wrongEngine = resolveSettings(
    {},
    {},
    {
      inference: "self-hosted",
      model: "qwen3-coder:30b",
      "gpu-type": "G",
      engine: "vllm",
    },
  );
  assert.ok(!wrongEngine.ok && wrongEngine.error.includes("the engine is `ollama`"));
  const wrongModel = resolveSettings(
    {},
    {},
    {
      inference: "self-hosted",
      model: "~org/model",
      "gpu-type": "G1",
    },
  );
  assert.ok(!wrongModel.ok && wrongModel.error.includes("ollama model name"));
});

test("self-hosted Serverless needs an endpoint and serves vLLM models", () => {
  const resolved = resolveSettings(
    {},
    {},
    {
      inference: "self-hosted",
      "gpu-mode": "serverless",
      "serverless-endpoint": "abc123xyz",
      model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    },
  );
  assert.ok(resolved.ok && resolved.value.engine === "vllm");
  const noEndpoint = resolveSettings(
    {},
    {},
    {
      inference: "self-hosted",
      "gpu-mode": "serverless",
      model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    },
  );
  assert.ok(!noEndpoint.ok && noEndpoint.error.includes("serverless-endpoint"));
});

test("checks each inference setting on its own, and a task may set its GPU type", () => {
  assert.equal(parseSetting("inference", "local").ok, false);
  assert.equal(parseSetting("gpu-mode", "spot").ok, false);
  assert.equal(parseSetting("pod-reuse", "run").ok, true);
  assert.equal(parseSetting("gpu-type", "NVIDIA GeForce RTX 4090").ok, true);
  assert.equal(parseSetting("gpu-type", "x; rm").ok, false);
  assert.equal(parseSetting("serverless-endpoint", "abc-123").ok, false);
  assert.ok(TASK_SETTINGS.has("gpu-type") && TASK_SETTINGS.has("model"));
  assert.ok(!TASK_SETTINGS.has("inference"));
});
