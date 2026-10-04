import assert from "node:assert/strict";
import { test } from "node:test";
import { openAiUsage } from "./engine.ts";
import { ollama, ollamaContextLength } from "./ollama.ts";
import { servedModels, vllm, vllmContextLength, vllmProblems } from "./vllm.ts";

test("reads OpenAI's usage, adding cached tokens back when the engine counts them apart", () => {
  const body = {
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 80 },
    },
  };
  assert.deepEqual(openAiUsage(body), { input: 100, output: 20 });
  assert.deepEqual(openAiUsage(body, true), { input: 180, output: 20 });
  assert.equal(openAiUsage({ choices: [] }), undefined);
  assert.equal(openAiUsage({ usage: { prompt_tokens: "1", completion_tokens: 2 } }), undefined);
  assert.equal(openAiUsage(null), undefined);
});

test("knows Ollama's model names and reads a model's context length", () => {
  for (const model of ["qwen3-coder:30b", "llama3.2", "hf.co/org/repo:Q4_K_M", "ns/model:tag"]) {
    assert.ok(ollama.isModel(model), model);
  }
  for (const model of ["", "a b", ":tag", "a/b/c/d", "x;rm"]) {
    assert.ok(!ollama.isModel(model), model);
  }
  assert.equal(
    ollamaContextLength({
      model_info: { "general.architecture": "qwen3moe", "qwen3moe.context_length": 262144 },
    }),
    262144,
  );
  assert.equal(ollamaContextLength({ model_info: {} }), undefined);
  assert.equal(ollamaContextLength("x"), undefined);
});

test("checks that a vLLM worker serves the model and calls tools", () => {
  const env = {
    MODEL_NAME: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    MAX_MODEL_LEN: "65536",
    ENABLE_AUTO_TOOL_CHOICE: "true",
    TOOL_CALL_PARSER: "qwen3_coder",
  };
  assert.ok(vllm.isModel("Qwen/Qwen3-Coder-30B-A3B-Instruct"));
  assert.ok(!vllm.isModel("a/b/c"));
  assert.deepEqual(vllmProblems(env, "Qwen/Qwen3-Coder-30B-A3B-Instruct"), []);
  assert.deepEqual(servedModels({ ...env, OPENAI_SERVED_MODEL_NAME_OVERRIDE: "coder" }), [
    "coder",
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  ]);
  assert.deepEqual(
    vllmProblems({ ...env, OPENAI_SERVED_MODEL_NAME_OVERRIDE: "coder" }, "coder"),
    [],
  );
  const problems = vllmProblems({ MODEL_NAME: "other/model" }, "Qwen/Qwen3-Coder-30B-A3B-Instruct");
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? "", /serves `other\/model`/);
  assert.match(problems[1] ?? "", /ENABLE_AUTO_TOOL_CHOICE/);
  assert.equal(vllmContextLength(env), 65536);
  assert.equal(vllmContextLength({}), undefined);
});
