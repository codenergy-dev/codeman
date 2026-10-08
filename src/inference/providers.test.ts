import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ACCOUNTS,
  accountOf,
  endpointId,
  isHourlyAccount,
  PROVIDER_NAMES,
  PROVIDERS,
  providerProblem,
  settingValues,
  withProviderDefaults,
} from "./providers.ts";

test("OpenRouter takes only an OpenRouter model", () => {
  assert.equal(providerProblem({ provider: "openrouter", model: "a/b" }), undefined);
  assert.match(
    providerProblem({ provider: "openrouter", model: "qwen3-coder:30b" }) ?? "",
    /With `openrouter`, `model` must be an OpenRouter model ID/,
  );
  for (const [setting, value] of [
    ["gpu", "NVIDIA RTX A6000"],
    ["engine", "ollama"],
    ["endpoint", "abc"],
    ["pod-reuse", "run"],
  ]) {
    assert.equal(
      providerProblem({ provider: "openrouter", model: "a/b", [setting as string]: value }),
      `\`openrouter\` does not accept \`${setting}\`; it takes only \`model\`.`,
    );
  }
});

test("a pod needs a GPU, serves Ollama models, and keeps the pod for the task by default", () => {
  const pod = { provider: "runpod-pod", model: "qwen3-coder:30b" };
  assert.equal(providerProblem(pod), '`runpod-pod` needs `gpu`, such as `"NVIDIA RTX A6000"`.');
  const settings = { ...pod, gpu: "NVIDIA RTX A6000" };
  assert.equal(providerProblem(settings), undefined);
  assert.deepEqual(withProviderDefaults(settings), {
    ...settings,
    engine: "ollama",
    "pod-reuse": "task",
  });
  assert.equal(providerProblem({ ...settings, "pod-reuse": "run" }), undefined);
  assert.equal(
    providerProblem({ ...settings, endpoint: "abc" }),
    "`runpod-pod` does not accept `endpoint`; besides `model`, it takes `engine`, `gpu` and `pod-reuse`.",
  );
  assert.equal(
    providerProblem({ ...settings, engine: "vllm" }),
    "`runpod-pod` does not offer the engine `vllm`; it offers `ollama`.",
  );
  assert.match(
    providerProblem({ ...settings, model: "not a model" }) ?? "",
    /With `runpod-pod`, `model` must be a model name of the engine `ollama`, such as `qwen3-coder:30b`/,
  );
});

test("Serverless needs an endpoint, serves vLLM models, and takes no GPU", () => {
  const serverless = { provider: "runpod-serverless", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct" };
  assert.equal(
    providerProblem(serverless),
    "`runpod-serverless` needs `endpoint`, such as `abc123xyz`.",
  );
  const settings = { ...serverless, endpoint: "abc123" };
  assert.equal(providerProblem(settings), undefined);
  assert.deepEqual(withProviderDefaults(settings), { ...settings, engine: "vllm" });
  assert.equal(
    providerProblem({ ...settings, gpu: "NVIDIA RTX A6000" }),
    "`runpod-serverless` does not accept `gpu`; besides `model`, it takes `engine` and `endpoint`.",
  );
  assert.equal(
    providerProblem({ ...settings, "pod-reuse": "task" }),
    "`runpod-serverless` does not accept `pod-reuse`; besides `model`, it takes `engine` and `endpoint`.",
  );
  assert.equal(
    providerProblem({ ...settings, engine: "ollama" }),
    "`runpod-serverless` does not offer the engine `ollama`; it offers `vllm`.",
  );
  assert.equal(
    providerProblem({ provider: "elsewhere", model: "a/b" }),
    "Unknown provider `elsewhere`.",
  );
});

test("each provider names its account, whose key and billing the budgets use", () => {
  assert.deepEqual(
    PROVIDER_NAMES.map((name) => accountOf(name)),
    ["openrouter", "runpod", "runpod"],
  );
  // Ledger runs written before providers name the account itself.
  assert.equal(accountOf("runpod"), "runpod");
  for (const provider of Object.values(PROVIDERS)) assert.ok(ACCOUNTS[provider.account]);
  assert.deepEqual(["openrouter", "runpod", "", "elsewhere"].map(isHourlyAccount), [
    false,
    true,
    false,
    false,
  ]);
  assert.deepEqual(
    PROVIDERS["runpod-serverless"].secrets.map(({ secret }) => secret),
    ["CODEMAN_RUNPOD_SERVERLESS_KEY"],
  );
});

test("a setting's values are every value some provider allows", () => {
  assert.deepEqual(settingValues("engine"), ["ollama", "vllm"]);
  assert.deepEqual(settingValues("pod-reuse"), ["task", "run"]);
  assert.equal(settingValues("gpu"), undefined);
});

test("an endpoint is its ID, or a URL of it on Runpod's API", () => {
  assert.deepEqual(endpointId("abc123xyz"), { ok: true, value: "abc123xyz" });
  for (const url of [
    "https://api.runpod.ai/v2/abc123xyz/run",
    "https://api.runpod.ai/v2/abc123xyz/openai/v1",
    "https://api.runpod.ai/v2/abc123xyz",
  ]) {
    assert.deepEqual(endpointId(url), { ok: true, value: "abc123xyz" });
  }
  for (const url of [
    "https://example.com/v2/abc123xyz/run",
    "http://api.runpod.ai/v2/abc123xyz/run",
    "https://api.runpod.ai:8443/v2/abc123xyz/run",
    "https://api.runpod.ai.example.com/v2/abc123xyz/run",
  ]) {
    const parsed = endpointId(url);
    assert.ok(!parsed.ok && parsed.error.includes("only URLs of `https://api.runpod.ai`"), url);
  }
  for (const text of [
    "https://api.runpod.ai/v1/abc123xyz/run",
    "https://api.runpod.ai/v2/abc-123/run",
    "https://user:secret@api.runpod.ai/v2/abc123xyz/run",
    "abc-123",
    "",
  ]) {
    assert.equal(endpointId(text).ok, false, text);
  }
});

test("the docs give each provider the settings, defaults and secrets of the registry", () => {
  const docs = readFileSync("docs/architecture.md", "utf8");
  const sections = docs.split(/^#### /m).slice(1);
  const documented = new Map(
    sections.map((section) => [/^`([a-z-]+)`/.exec(section)?.[1] ?? "", section]),
  );
  assert.deepEqual([...documented.keys()], [...PROVIDER_NAMES]);
  for (const name of PROVIDER_NAMES) {
    const section = (documented.get(name) ?? "").split(/^##/m)[0] ?? "";
    const rows = [...section.matchAll(/^\| `([a-z-]+)` \| ([^|]+) \|/gm)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]);
    const expected = Object.entries(PROVIDERS[name].settings).map(([setting, spec]) => [
      setting,
      spec.required ? "none; required" : `\`${spec.default}\``,
    ]);
    assert.deepEqual(rows.sort(), expected.sort(), name);
    const secrets = [
      ...(/^- \*\*Secrets:\*\* (.*)$/m.exec(section)?.[1] ?? "").matchAll(/`([A-Z_]+)`/g),
    ];
    assert.deepEqual(
      secrets.map((match) => match[1]),
      [
        ACCOUNTS[PROVIDERS[name].account]?.secret,
        ...PROVIDERS[name].secrets.map(({ secret }) => secret),
      ],
      name,
    );
  }
});
