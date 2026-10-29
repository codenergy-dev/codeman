import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HOST_KINDS } from "./gpu.ts";
import {
  ACCOUNTS,
  accountOf,
  endpointId,
  hostKinds,
  isHourlyAccount,
  listSetting,
  PROVIDER_NAMES,
  PROVIDERS,
  providerProblem,
  settingValues,
  withProviderDefaults,
} from "./providers.ts";
import { TOOL_CALL_PARSER_NEEDED } from "./vllm.ts";

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
    hosts: "secure",
    priority: "on-demand",
  });
  assert.equal(providerProblem({ ...settings, "pod-reuse": "run" }), undefined);
  assert.equal(
    providerProblem({ ...settings, endpoint: "abc" }),
    "`runpod-pod` does not accept `endpoint`; besides `model`, it takes `engine`, `gpu`, `pod-reuse`, `hosts`, `priority`, `ollama` and `vllm`.",
  );
  assert.equal(
    providerProblem({ ...settings, engine: "sglang" }),
    "`runpod-pod` does not offer the engine `sglang`; it offers `ollama`, `vllm`.",
  );
  assert.match(
    providerProblem({ ...settings, model: "not a model" }) ?? "",
    /With `runpod-pod`, `model` must be a model name of the engine `ollama`, such as `qwen3-coder:30b`/,
  );
});

test("a pod's hosts list kinds of host by preference, and Runpod offers one priority", () => {
  const settings = { provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "NVIDIA RTX A6000" };
  assert.equal(providerProblem({ ...settings, hosts: "community,secure" }), undefined);
  assert.equal(providerProblem({ ...settings, hosts: "community" }), undefined);
  assert.equal(
    providerProblem({ ...settings, hosts: "secure,datacenter" }),
    "With `runpod-pod`, `hosts` must list some of `secure`, `community`, each once, such as `[secure, community]`.",
  );
  assert.equal(
    providerProblem({ ...settings, hosts: "secure,secure" }),
    "With `runpod-pod`, `hosts` lists a value twice: list each of `secure`, `community` once.",
  );
  assert.equal(providerProblem({ ...settings, priority: "on-demand" }), undefined);
  assert.equal(
    providerProblem({ ...settings, priority: "spot" }),
    "With `runpod-pod`, `priority` must be one of `on-demand`, not `spot`.",
  );
  assert.deepEqual(listSetting("hosts", "[community, secure]", HOST_KINDS), {
    ok: true,
    value: "community,secure",
  });
  assert.deepEqual(hostKinds(undefined), ["secure"]);
  assert.deepEqual(hostKinds("community,secure"), ["community", "secure"]);
  // Neither Serverless nor OpenRouter takes them: an endpoint's cloud is set on the endpoint.
  for (const other of [
    { provider: "runpod-serverless", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct", endpoint: "a1" },
    { provider: "openrouter", model: "a/b" },
  ]) {
    assert.match(providerProblem({ ...other, hosts: "secure" }) ?? "", /does not accept `hosts`/);
    assert.match(
      providerProblem({ ...other, priority: "on-demand" }) ?? "",
      /does not accept `priority`/,
    );
  }
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
  const docs = readFileSync("docs/settings/providers.md", "utf8");
  // Each provider is a `##` section named after it, such as "## `openrouter`".
  const sections = docs
    .split(/^## /m)
    .slice(1)
    .filter((section) => section.startsWith("`"));
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
    const expected = [
      ...Object.entries(PROVIDERS[name].settings).map(([setting, spec]) => [
        setting,
        spec.required ? "none; required" : `\`${spec.default}\``,
      ]),
      // A block has no default: without it, the engine's own.
      ...Object.keys(PROVIDERS[name].blocks ?? {}).map((block) => [block, "none"]),
    ];
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

test("pods take an `ollama` block, checked against Ollama's list", () => {
  const pod = { provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "GPU" };
  assert.equal(providerProblem({ ...pod, ollama: { "num-parallel": "4" } }), undefined);
  assert.equal(
    providerProblem({ ...pod, ollama: { host: "0.0.0.0" } }),
    "`ollama` cannot set `host`: Codeman runs Ollama on the pod's loopback, where only its gateway reaches it.",
  );
  assert.equal(
    providerProblem({ provider: "openrouter", model: "a/b", ollama: { "num-parallel": "4" } }),
    "`openrouter` does not accept `ollama`; it takes only `model`.",
  );
  assert.deepEqual(PROVIDERS["runpod-pod"].blocks, {
    ollama: { engine: "ollama" },
    vllm: { engine: "vllm" },
  });
});

test("pods serve Hugging Face models with vLLM, which needs the model's tool call parser", () => {
  const pod = {
    provider: "runpod-pod",
    model: "unsloth/Qwen3.8-27B-NVFP4",
    gpu: "GPU",
    engine: "vllm",
  };
  assert.equal(providerProblem(pod), TOOL_CALL_PARSER_NEEDED);
  assert.equal(providerProblem(pod, false), undefined, "settings that serve no run");
  const vllm = { "tool-call-parser": "qwen3_xml" };
  assert.equal(providerProblem({ ...pod, vllm }), undefined);
  assert.equal(
    providerProblem({ ...pod, vllm, model: "Qwen3-8B" }),
    "With `runpod-pod` and the engine `vllm`, `model` must be a Hugging Face model ID, `namespace/name`, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`, not `Qwen3-8B`.",
  );
  assert.match(
    providerProblem({ ...pod, vllm, model: "qwen3-coder:30b" }) ?? "",
    /must be a Hugging Face model ID/,
  );
  assert.equal(
    providerProblem({ ...pod, vllm: { ...vllm, host: "0.0.0.0" } }),
    "`vllm` cannot set `host`: Codeman serves the run's model on the pod's loopback, behind its gateway.",
  );
  assert.equal(
    providerProblem({ ...pod, vllm: { ...vllm, "speculative-method": "mtp" } }),
    "`vllm`'s `speculative-method` needs `speculative-tokens`, the tokens drafted per step, such as `3`.",
    "the block is checked whole",
  );
  assert.equal(
    providerProblem({ ...pod, vllm, ollama: { "num-parallel": "4" } }),
    "With `runpod-pod`, `ollama` configures the engine `ollama`, not `vllm`.",
  );
  assert.equal(
    providerProblem({ ...pod, engine: "ollama", model: "qwen3:8b", vllm }),
    "With `runpod-pod`, `vllm` configures the engine `vllm`, not `ollama`.",
  );
  assert.equal(
    providerProblem({
      provider: "runpod-serverless",
      model: "Qwen3-8B",
      endpoint: "abc",
      vllm,
    }),
    "`runpod-serverless` does not accept `vllm`; besides `model`, it takes `engine` and `endpoint`.",
    "Serverless endpoints keep their worker's settings",
  );
});
