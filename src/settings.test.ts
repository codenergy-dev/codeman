import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PROVIDERS } from "./inference/providers.ts";
import {
  DEFAULTS,
  type PartialSettings,
  PROFILE_STAGES,
  type ProfileStage,
  parseSetting,
  parseSettings,
  resolveRun,
  resolveSettings,
  type Settings,
  SHARED_SETTINGS,
  settingSources,
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

test("the organization's settings come after the file, and errors name where they are", () => {
  const shared = parseSettings(
    "model: org/model\ntask-budget: 4\nmonthly-budget: 40\nmax-runs: 6\nlanguage: pt-BR",
    SHARED_SETTINGS,
  );
  assert.ok(shared.ok);
  if (!shared.ok) return;
  const layers = [
    { "task-budget": 5 },
    { "max-runs": 2 },
    { model: "file/model", "monthly-budget": 50, "max-runs": 9 },
    shared.value,
  ];
  assert.deepEqual(resolveSettings(...layers), {
    ok: true,
    value: {
      ...DEFAULTS,
      model: "file/model",
      "task-budget": 5,
      "monthly-budget": 50,
      "max-runs": 2,
      language: "pt-BR",
    },
  });
  assert.deepEqual(settingSources(layers), [
    "Settings from the task's commands: task-budget=5.",
    "Settings from the workflow's inputs: max-runs=2.",
    "Settings from .codeman/settings.yml: model=file/model, monthly-budget=50.",
    `Settings from ${SHARED_SETTINGS}: language=pt-BR.`,
  ]);
  assert.deepEqual(settingSources([{}, {}, {}, { model: "org/model" }]), [
    `Settings from ${SHARED_SETTINGS}: model=org/model.`,
  ]);

  const invalid = parseSettings("model: a/b\nsecret: x", SHARED_SETTINGS);
  assert.deepEqual(invalid, {
    ok: false,
    error:
      "the `settings` input (organization variable CODEMAN_SETTINGS), line 2: unknown setting `secret`.",
  });
  const file = parseSettings("secret: x");
  assert.ok(!file.ok && file.error.startsWith(".codeman/settings.yml, line 1:"));
});

test("only the organization's settings set organization-monthly-budget", () => {
  const shared = parseSettings("model: a/b\norganization-monthly-budget: 60", SHARED_SETTINGS);
  assert.ok(shared.ok);
  if (!shared.ok) return;
  assert.equal(shared.value["organization-monthly-budget"], 60);
  const resolved = resolveSettings({}, {}, { "monthly-budget": 30 }, shared.value);
  assert.ok(resolved.ok && resolved.value["organization-monthly-budget"] === 60);
  assert.ok(resolved.ok && resolved.value["monthly-budget"] === 30);
  const none = resolveSettings({ model: "a/b" });
  assert.ok(none.ok && none.value["organization-monthly-budget"] === undefined, "no default");

  assert.deepEqual(parseSettings("model: a/b\norganization-monthly-budget: 1000"), {
    ok: false,
    error:
      ".codeman/settings.yml, line 2: `organization-monthly-budget` can be set only in the organization's settings, the CODEMAN_SETTINGS variable.",
  });
  const profile = parseSettings(
    "model: a/b\nprofiles:\n  - name: p\n    organization-monthly-budget: 1000",
    SHARED_SETTINGS,
  );
  assert.ok(
    !profile.ok && /a profile cannot set `organization-monthly-budget`/.test(profile.error),
  );
  assert.ok(!TASK_SETTINGS.has("organization-monthly-budget"), "nor a command");
  assert.deepEqual(parseSettings("organization-monthly-budget: 0", SHARED_SETTINGS), {
    ok: false,
    error:
      "the `settings` input (organization variable CODEMAN_SETTINGS), line 1: `organization-monthly-budget` must be a positive number.",
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

test("a run takes one task by default, and up to ten at once", () => {
  const resolved = resolveSettings({ model: "a/b" });
  assert.ok(resolved.ok && resolved.value["parallel-tasks"] === 1);
  assert.deepEqual(parseSettings("parallel-tasks: 3"), {
    ok: true,
    value: { "parallel-tasks": 3 },
  });
  for (const text of ["0", "11", "1.5", "two"]) {
    assert.equal(parseSetting("parallel-tasks", text).ok, false, text);
  }
  assert.ok(!TASK_SETTINGS.has("parallel-tasks"), "one run's, not a task's");
});

test("OpenRouter is the default provider, and takes only OpenRouter model IDs", () => {
  const resolved = resolveSettings({}, {}, { model: "deepseek/deepseek-v4.1-flash" });
  assert.ok(resolved.ok && resolved.value.provider === "openrouter");
  assert.ok(resolved.ok && resolved.value.engine === undefined);
  assert.ok(resolved.ok && !("pod-reuse" in resolved.value));
  const ollamaName = resolveSettings({}, {}, { model: "qwen3-coder:30b" });
  assert.ok(!ollamaName.ok && ollamaName.error.includes("OpenRouter model ID"));
  const gpu = parseSettings('provider: openrouter\nmodel: a/b\ngpu: "NVIDIA RTX A6000"');
  assert.ok(gpu.ok);
  const refused = resolveSettings({}, {}, gpu.ok ? gpu.value : {});
  assert.deepEqual(refused, {
    ok: false,
    error: "`openrouter` does not accept `gpu`; it takes only `model`.",
  });
});

test("pods need a GPU, serve Ollama models, and keep the pod for the task", () => {
  const file = parseSettings(
    'provider: runpod-pod\nmodel: qwen3-coder:30b\ngpu: "NVIDIA RTX A6000"',
  );
  assert.ok(file.ok);
  const resolved = resolveSettings({}, {}, file.ok ? file.value : {});
  assert.ok(resolved.ok);
  if (!resolved.ok) return;
  assert.equal(resolved.value.provider, "runpod-pod");
  assert.equal(resolved.value.gpu, "NVIDIA RTX A6000");
  assert.equal(resolved.value.engine, "ollama");
  assert.equal(resolved.value["pod-reuse"], "task");

  const noGpu = resolveSettings({}, {}, { provider: "runpod-pod", model: "qwen3-coder:30b" });
  assert.ok(!noGpu.ok && noGpu.error.includes("`runpod-pod` needs `gpu`"));
  const wrongEngine = resolveSettings(
    {},
    {},
    { provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "G", engine: "vllm" },
  );
  assert.ok(!wrongEngine.ok && wrongEngine.error.includes("does not offer the engine `vllm`"));
  const wrongModel = resolveSettings(
    {},
    {},
    { provider: "runpod-pod", model: "~org/model", gpu: "G1" },
  );
  assert.ok(!wrongModel.ok && wrongModel.error.includes("model name of the engine `ollama`"));
  const endpoint = resolveSettings(
    {},
    {},
    { provider: "runpod-pod", model: "qwen3-coder:30b", gpu: "G", endpoint: "abc" },
  );
  assert.ok(!endpoint.ok && endpoint.error.includes("`runpod-pod` does not accept `endpoint`"));
});

test("Serverless needs an endpoint, by ID or URL, serves vLLM models, and takes no GPU", () => {
  const file = parseSettings(
    [
      "provider: runpod-serverless",
      "endpoint: https://api.runpod.ai/v2/abc123xyz/openai/v1",
      "model: Qwen/Qwen3-Coder-30B-A3B-Instruct",
    ].join("\n"),
  );
  assert.ok(file.ok && file.value.endpoint === "abc123xyz", "the URL's endpoint ID");
  const resolved = resolveSettings({}, {}, file.ok ? file.value : {});
  assert.ok(resolved.ok && resolved.value.engine === "vllm");
  assert.ok(resolved.ok && resolved.value.endpoint === "abc123xyz");
  const elsewhere = parseSettings("endpoint: https://example.com/v2/abc123xyz/run");
  assert.ok(
    !elsewhere.ok &&
      elsewhere.error.startsWith(
        ".codeman/settings.yml, line 1: `endpoint` takes only URLs of `https://api.runpod.ai`",
      ),
  );
  const noEndpoint = resolveSettings(
    {},
    {},
    { provider: "runpod-serverless", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct" },
  );
  assert.ok(!noEndpoint.ok && noEndpoint.error.includes("`runpod-serverless` needs `endpoint`"));
  const gpu = resolveSettings(
    {},
    {},
    {
      provider: "runpod-serverless",
      endpoint: "abc",
      gpu: "G",
      model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    },
  );
  assert.ok(!gpu.ok && gpu.error.startsWith("`runpod-serverless` does not accept `gpu`"));
});

test("checks each provider setting on its own, and a task may set its GPU", () => {
  assert.equal(parseSetting("provider", "self-hosted").ok, false);
  assert.equal(parseSetting("provider", "runpod-serverless").ok, true);
  assert.equal(parseSetting("engine", "llama.cpp").ok, false);
  assert.equal(parseSetting("pod-reuse", "run").ok, true);
  assert.equal(parseSetting("gpu", "NVIDIA GeForce RTX 4090").ok, true);
  assert.equal(parseSetting("gpu", "x; rm").ok, false);
  assert.equal(parseSetting("endpoint", "abc-123").ok, false);
  assert.ok(TASK_SETTINGS.has("gpu") && TASK_SETTINGS.has("model"));
  assert.ok(!TASK_SETTINGS.has("provider"));
});

test("an old name stops the run with an error that gives the new one", () => {
  const cases: [string, string][] = [
    ["gpu-type: NVIDIA RTX A6000", "`gpu-type` is now `gpu`."],
    ["inference: openrouter", "`inference` is now `provider`: write `provider: openrouter`."],
    [
      "inference: self-hosted",
      "`inference` is now `provider`: write `provider: runpod-pod` or `provider: runpod-serverless`.",
    ],
    [
      "gpu-mode: serverless",
      "`gpu-mode` is now part of `provider`: write `provider: runpod-serverless`.",
    ],
    ["gpu-mode: pod", "`gpu-mode` is now part of `provider`: write `provider: runpod-pod`."],
    [
      "gpu-provider: runpod",
      "`gpu-provider` is now part of `provider`: write `provider: runpod-pod` or `provider: runpod-serverless`.",
    ],
    [
      "serverless-endpoint: abc123",
      "`serverless-endpoint` is now `endpoint`, with `provider: runpod-serverless`.",
    ],
    ["inference-profiles: []", "`inference-profiles` is now `profiles`."],
  ];
  for (const [text, error] of cases) {
    assert.deepEqual(parseSettings(`model: a/b\n${text}`), {
      ok: false,
      error: `.codeman/settings.yml, line 2: ${error}`,
    });
  }
  // In a profile, and in the organization's settings.
  assert.deepEqual(parseSettings("profiles:\n  - name: a\n    gpu-type: G"), {
    ok: false,
    error: ".codeman/settings.yml, line 3: `gpu-type` is now `gpu`.",
  });
  assert.deepEqual(parseSettings("inference-profiles: []", SHARED_SETTINGS), {
    ok: false,
    error: `${SHARED_SETTINGS}, line 1: \`inference-profiles\` is now \`profiles\`.`,
  });
});

test("reads profiles: a list of blocks, with conditions", () => {
  const valid = parseSettings(
    [
      "model: anthropic/claude-sonnet-4.5     # the default profile",
      "profiles:",
      "  - name: small-pod",
      "    when:",
      "      stages: [route, code, test]",
      "      parallel-tasks: 2                 # when the run has at least 2 tasks",
      "    provider: runpod-pod",
      "    gpu: NVIDIA RTX A6000",
      "    model: qwen3-coder:30b",
      "",
      "  # A block list of stages reads as the brackets do.",
      "  - name: coder",
      "    when:",
      "      stages:",
      "        - code",
      "        - 'test'",
      "    model: qwen/qwen3-coder",
      "max-runs: 4",
    ].join("\n"),
  );
  assert.deepEqual(valid, {
    ok: true,
    value: {
      model: "anthropic/claude-sonnet-4.5",
      profiles: [
        {
          name: "small-pod",
          when: { stages: ["route", "code", "test"], "parallel-tasks": 2 },
          settings: {
            provider: "runpod-pod",
            gpu: "NVIDIA RTX A6000",
            model: "qwen3-coder:30b",
          },
        },
        {
          name: "coder",
          when: { stages: ["code", "test"] },
          settings: { model: "qwen/qwen3-coder" },
        },
      ],
      "max-runs": 4,
    },
  });
  const sameIndent = parseSettings(
    "model: a/b\nprofiles:\n- name: planner\n  when:\n    stages: [plan]\n  model: c/d\nmax-runs: 2",
  );
  assert.deepEqual(sameIndent, {
    ok: true,
    value: {
      model: "a/b",
      profiles: [{ name: "planner", when: { stages: ["plan"] }, settings: { model: "c/d" } }],
      "max-runs": 2,
    },
  });
  assert.deepEqual(parseSettings("profiles: []"), { ok: true, value: { profiles: [] } });
  const flowMapping = parseSettings("profiles:\n  - name: a\n    when: {stages: [plan]}");
  assert.ok(!flowMapping.ok && flowMapping.error.includes("line 3"), "not in the subset");
});

test("rejects malformed profiles, naming the line", () => {
  const cases: [string, string][] = [
    ["profiles:\n  - model: a/b", "line 2: a profile needs a `name`."],
    [
      "profiles:\n  - name: a\n    task-budget: 5",
      "line 3: a profile cannot set `task-budget`; it sets only `provider`, `model`, `engine`, `gpu`, `endpoint`, `pod-reuse`.",
    ],
    ["profiles:\n  - name: a\n    secret: x", "line 3: unknown setting `secret`."],
    ["profiles:\n  - name: a\n    provider: spot", "line 3: `provider` must be one of"],
    ["profiles:\n  - name: a\n  - name: a", "line 3: two profiles are named `a`."],
    ["profiles:\n  - name: a b", "line 2: a profile's `name` must be"],
    ["profiles:\n  - name: a\n    when:\n      stages: [deploy]", "line 4: `stages` must list"],
    ["profiles:\n  - name: a\n    when:\n      stages: []", "line 4: `stages` must list"],
    ["profiles:\n  - name: a\n    when:\n      parallel-tasks: 0", "line 4: `parallel-tasks` must"],
    ["profiles:\n  - name: a\n    when:\n      labels: [x]", "line 4: unknown condition `labels`"],
    ["profiles:\n  - name: a\n    when: plan", "line 3: `when` must be a block"],
    ["profiles: [a, b]", "line 1: `profiles` must be a list of profiles"],
    ["profiles:\n  - a", "line 2: `profiles` must be a list of profiles"],
    ["profiles:", "line 1: `profiles` must be a list of profiles"],
    ["profiles:\n  - name: a\n     model: b/c", "line 3: unexpected indentation."],
    ["profiles:\n  - name: a\n   model: b/c", "line 3: unexpected indentation."],
    ["profiles:\n  -\n    name: a", "line 2: expected a value after `-`"],
    ["profiles:\n  - - name: a", "line 2: a list item cannot be a list."],
    ["profiles:\n\t- name: a", "line 2: indent with spaces, not tabs."],
    ["model: [a/b", "line 1: an item of `model` is not a plain value."],
    ["model: [a/b] x", "line 1: expected only a comment after the list of `model`."],
    ["model: a/b\nmodel:\n  - c/d", "line 2: `model` appears twice."],
    ["model:\n  - c/d", "line 1: the value of `model` is not a plain value."],
    ["model: a: b", "line 1: the value of `model` is not a plain value."],
    ["max-runs: 2\n  max-files: 3", "line 2: unexpected indentation."],
  ];
  for (const [text, error] of cases) {
    const parsed = parseSettings(text);
    assert.ok(!parsed.ok, text);
    if (!parsed.ok)
      assert.ok(parsed.error.startsWith(`.codeman/settings.yml, ${error}`), parsed.error);
  }
});

test("today's flat files read the same, and the template is one", () => {
  const text = readFileSync("templates/settings.yml", "utf8");
  assert.ok(parseSettings(text).ok);
  // Each provider's block and the profiles, once uncommented, read too; a provider's block
  // names the settings the provider accepts.
  const blocks = text.split(/\n\n/).filter((part) => /^# (provider|profiles):/m.test(part));
  const named = blocks.map((block) => {
    const uncommented = parseSettings(block.replace(/^# (?=[a-z-]+:( \S+| "[^"]*")?$| {2})/gm, ""));
    assert.ok(uncommented.ok, uncommented.ok ? "" : uncommented.error);
    return uncommented.ok ? uncommented.value : {};
  });
  for (const name of ["runpod-pod", "runpod-serverless"] as const) {
    const block = named.find((settings) => settings.provider === name && !settings.profiles);
    assert.deepEqual(
      Object.keys(block ?? {})
        .filter((setting) => setting !== "provider")
        .sort(),
      Object.keys(PROVIDERS[name].settings).sort(),
      name,
    );
  }
  assert.ok(named.some((settings) => settings.profiles?.[0]?.name === "small-pod"));
  assert.deepEqual(parseSettings("gpu: \"NVIDIA RTX A6000\"\nmodel: '~a/b' # latest"), {
    ok: true,
    value: { gpu: "NVIDIA RTX A6000", model: "~a/b" },
  });
  // A plain value of several words, as YAML reads it.
  assert.deepEqual(parseSettings("gpu: NVIDIA RTX  A6000 # two spaces"), {
    ok: true,
    value: { gpu: "NVIDIA RTX  A6000" },
  });
});

/** The plan's example, with a profile per stage and the default for the others. */
function profiled(extra: PartialSettings = {}) {
  const file = parseSettings(
    [
      "model: anthropic/claude-sonnet-4.5",
      "profiles:",
      "  - name: crowded",
      "    when:",
      "      parallel-tasks: 2",
      "    model: deepseek/deepseek-v4.1-flash",
      "  - name: planner",
      "    when:",
      "      stages: [plan, route]",
      "    model: openai/gpt-5",
      "  - name: small-pod",
      "    when:",
      "      stages: [code, test]",
      "    provider: runpod-pod",
      "    gpu: NVIDIA RTX A6000",
      "    model: qwen3-coder:30b",
      "  - name: reviewer",
      "    when:",
      "      stages: [review]",
      "    provider: runpod-serverless",
      "    endpoint: abc123",
      "    model: Qwen/Qwen3-Coder-30B-A3B-Instruct",
    ].join("\n"),
  );
  assert.ok(file.ok);
  return file.ok ? [extra, {}, file.value] : [];
}

test("a run uses the first profile whose conditions hold, else the top-level settings", () => {
  const layers = profiled();
  const run = (stage: ProfileStage, tasks = 1) => {
    const resolved = resolveRun(layers, { stage, tasks });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    return resolved.ok ? resolved.value : undefined;
  };
  assert.deepEqual(
    PROFILE_STAGES.map((stage) => [stage, run(stage)?.profile, run(stage)?.settings.model]),
    [
      ["plan", "planner", "openai/gpt-5"],
      ["route", "planner", "openai/gpt-5"],
      ["web", undefined, "anthropic/claude-sonnet-4.5"],
      ["design", undefined, "anthropic/claude-sonnet-4.5"],
      ["code", "small-pod", "qwen3-coder:30b"],
      ["test", "small-pod", "qwen3-coder:30b"],
      ["review", "reviewer", "Qwen/Qwen3-Coder-30B-A3B-Instruct"],
    ],
  );
  const pod = run("code")?.settings;
  assert.equal(pod?.provider, "runpod-pod");
  assert.equal(pod?.engine, "ollama");
  assert.equal(pod?.["pod-reuse"], "task");
  assert.equal(run("review")?.settings.engine, "vllm", "the provider's engine");
  assert.equal(run("web")?.settings.provider, "openrouter");
  assert.equal(run("code", 2)?.profile, "crowded", "first in the file's order");
  assert.deepEqual(run("plan")?.accounts, ["openrouter", "runpod"]);
  // Without a run, as for recording answers, no profile applies.
  const top = resolveSettings(...layers);
  assert.ok(top.ok && top.value.model === "anthropic/claude-sonnet-4.5");
  assert.ok(top.ok && !("profiles" in top.value));
});

test("a profile on another provider leaves out the top level's provider settings", () => {
  const file = parseSettings(
    [
      "provider: runpod-pod",
      "gpu: NVIDIA RTX A6000",
      "pod-reuse: run",
      "model: qwen3-coder:30b",
      "profiles:",
      "  - name: reviewer",
      "    when:",
      "      stages: [review]",
      "    provider: runpod-serverless",
      "    endpoint: https://api.runpod.ai/v2/abc123/run",
      "    model: Qwen/Qwen3-Coder-30B-A3B-Instruct",
      "  - name: planner",
      "    when:",
      "      stages: [plan]",
      "    provider: openrouter",
      "    model: openai/gpt-5",
      "  - name: big-pod",
      "    when:",
      "      stages: [code]",
      "    gpu: NVIDIA A100 80GB PCIe",
    ].join("\n"),
  );
  assert.ok(file.ok, file.ok ? "" : file.error);
  const layers = [{}, {}, file.ok ? file.value : {}];
  const settings = (stage: ProfileStage) => {
    const resolved = resolveRun(layers, { stage, tasks: 1 });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    return resolved.ok ? resolved.value.settings : undefined;
  };
  const review = settings("review");
  assert.deepEqual(
    [review?.provider, review?.endpoint, review?.engine, review?.gpu, review?.["pod-reuse"]],
    ["runpod-serverless", "abc123", "vllm", undefined, undefined],
  );
  const plan = settings("plan");
  assert.deepEqual([plan?.provider, plan?.gpu, plan?.engine], ["openrouter", undefined, undefined]);
  // A profile on the same provider keeps the top level's settings it does not set.
  const code = settings("code");
  assert.deepEqual(
    [code?.provider, code?.gpu, code?.["pod-reuse"], code?.model],
    ["runpod-pod", "NVIDIA A100 80GB PCIe", "run", "qwen3-coder:30b"],
  );
  // A profile's settings must fit its own provider.
  const wrong = parseSettings(
    "model: a/b\nprofiles:\n  - name: planner\n    when:\n      stages: [plan]\n    gpu: GPU",
  );
  const resolved = resolveRun([{}, {}, wrong.ok ? wrong.value : {}], { stage: "code", tasks: 1 });
  assert.deepEqual(resolved, {
    ok: false,
    error: "Profile `planner`: `openrouter` does not accept `gpu`; it takes only `model`.",
  });
});

test("a layer on another provider leaves out the provider settings of the layers below", () => {
  const shared = parseSettings(
    "provider: runpod-pod\ngpu: GPU\nmodel: qwen3-coder:30b",
    SHARED_SETTINGS,
  );
  assert.ok(shared.ok);
  if (!shared.ok) return;
  const openrouter = resolveSettings(
    {},
    {},
    { provider: "openrouter", model: "a/b" },
    shared.value,
  );
  assert.ok(openrouter.ok && openrouter.value.gpu === undefined);
  const kept = resolveSettings({}, {}, { provider: "runpod-pod" }, shared.value);
  assert.ok(kept.ok && kept.value.gpu === "GPU", "the same provider keeps them");
});

test("a task's model wins over the profile, and must fit its provider", () => {
  const layers = profiled({ model: "qwen3-coder:480b", "task-budget": 5 });
  const code = resolveRun(layers, { stage: "code", tasks: 1 });
  assert.ok(code.ok);
  assert.equal(code.ok && code.value.settings.model, "qwen3-coder:480b");
  assert.equal(code.ok && code.value.settings["task-budget"], 5);
  assert.equal(code.ok && code.value.profile, "small-pod");
  const plan = resolveRun(layers, { stage: "plan", tasks: 1 });
  assert.ok(
    !plan.ok && plan.error.startsWith("Profile `planner`: With `openrouter`, `model` must be"),
  );
});

test("a task's GPU applies to the runs whose provider accepts it", () => {
  const layers = profiled({ gpu: "NVIDIA RTX A5000" });
  const code = resolveRun(layers, { stage: "code", tasks: 1 });
  assert.ok(code.ok && code.value.settings.gpu === "NVIDIA RTX A5000");
  const plan = resolveRun(layers, { stage: "plan", tasks: 1 });
  assert.ok(plan.ok && plan.value.settings.gpu === undefined);
  const review = resolveRun(layers, { stage: "review", tasks: 1 });
  assert.ok(review.ok && review.value.settings.gpu === undefined);
  // When no provider of the settings accepts it, it is an error, which `select` reports.
  const none = resolveRun([{ gpu: "G" }, {}, { model: "a/b" }], { stage: "code", tasks: 1 });
  assert.deepEqual(none, {
    ok: false,
    error: "No provider of the settings accepts `gpu`: they name `openrouter`.",
  });
});

test("every profile must fit with the top-level settings, whichever stage runs", () => {
  const file = parseSettings(
    "model: a/b\nprofiles:\n  - name: pods\n    when:\n      stages: [code]\n    provider: runpod-pod\n    model: qwen3-coder:30b",
  );
  assert.ok(file.ok);
  const resolved = resolveRun([{}, {}, file.ok ? file.value : {}], { stage: "plan", tasks: 1 });
  assert.ok(!resolved.ok && resolved.error.startsWith("Profile `pods`: `runpod-pod` needs `gpu`"));
});

test("the repository's profiles replace the organization's whole, and the log names them", () => {
  const shared = parseSettings(
    "model: org/model\nprofiles:\n  - name: org-plan\n    when:\n      stages: [plan]\n    model: org/planner",
    SHARED_SETTINGS,
  );
  const file = parseSettings(
    "profiles:\n  - name: repo-code\n    when:\n      stages: [code]\n    model: repo/coder",
  );
  assert.ok(shared.ok && file.ok);
  if (!shared.ok || !file.ok) return;
  const layers = [{}, {}, file.value, shared.value];
  const plan = resolveRun(layers, { stage: "plan", tasks: 1 });
  assert.ok(
    plan.ok && plan.value.profile === undefined && plan.value.settings.model === "org/model",
  );
  const code = resolveRun(layers, { stage: "code", tasks: 1 });
  assert.ok(code.ok && code.value.profile === "repo-code");
  assert.deepEqual(settingSources(layers), [
    "Settings from .codeman/settings.yml: profiles=[repo-code].",
    `Settings from ${SHARED_SETTINGS}: model=org/model.`,
  ]);
  // A file without profiles keeps the organization's; `[]` removes them.
  const kept = resolveRun([{}, {}, {}, shared.value], { stage: "plan", tasks: 1 });
  assert.ok(kept.ok && kept.value.profile === "org-plan");
  const none = parseSettings("profiles: []");
  const removed = resolveRun([{}, {}, none.ok ? none.value : {}, shared.value], {
    stage: "plan",
    tasks: 1,
  });
  assert.ok(removed.ok && removed.value.profile === undefined);
});

// The examples of docs/settings/provider-settings-across-layers.md, with their outcomes.
describe("provider settings across layers", () => {
  const layer = (lines: string[], source?: string) => {
    const parsed = parseSettings(lines.join("\n"), source);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
    return parsed.ok ? parsed.value : {};
  };
  const serving = (settings: Partial<Settings> | undefined) => [
    settings?.provider,
    settings?.model,
    settings?.engine,
    settings?.gpu,
    settings?.endpoint,
    settings?.["pod-reuse"],
  ];
  const organization = () =>
    layer(
      [
        "provider: runpod-pod",
        "model: qwen3-coder:30b",
        'gpu: "NVIDIA RTX A6000"',
        "pod-reuse: run",
        "task-budget: 1",
      ],
      SHARED_SETTINGS,
    );

  test("1. a profile that switches provider starts without the provider settings below", () => {
    const file = layer([
      "provider: runpod-pod",
      "model: qwen3-coder:30b",
      'gpu: "NVIDIA RTX A6000"',
      "profiles:",
      "  - name: serverless-review",
      "    when:",
      "      stages: [review]",
      "    provider: runpod-serverless",
      "    endpoint: abc123xyz",
      "    model: Qwen/Qwen3-Coder-30B-A3B-Instruct",
    ]);
    const review = resolveRun([{}, {}, file], { stage: "review", tasks: 1 });
    assert.ok(review.ok && review.value.profile === "serverless-review");
    assert.deepEqual(serving(review.ok ? review.value.settings : undefined), [
      "runpod-serverless",
      "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      "vllm",
      undefined,
      "abc123xyz",
      undefined,
    ]);
    const code = resolveRun([{}, {}, file], { stage: "code", tasks: 1 });
    assert.deepEqual(serving(code.ok ? code.value.settings : undefined), [
      "runpod-pod",
      "qwen3-coder:30b",
      "ollama",
      "NVIDIA RTX A6000",
      undefined,
      "task",
    ]);
  });

  test("2. a repository on another provider drops the organization's, but not its budgets", () => {
    const file = layer(["provider: openrouter", "model: deepseek/deepseek-v4.1-flash"]);
    const resolved = resolveRun([{}, {}, file, organization()], { stage: "code", tasks: 1 });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    const settings = resolved.ok ? resolved.value.settings : undefined;
    assert.deepEqual(serving(settings), [
      "openrouter",
      "deepseek/deepseek-v4.1-flash",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    assert.equal(settings?.["task-budget"], 1);
    // Without its own model, the organization's carries over, and does not fit OpenRouter.
    const alone = resolveRun([{}, {}, layer(["provider: openrouter"]), organization()], {
      stage: "code",
      tasks: 1,
    });
    assert.deepEqual(alone, {
      ok: false,
      error:
        "With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:30b`.",
    });
  });

  test("3. no provider, or the same one, keeps the provider settings below", () => {
    for (const lines of [
      ["model: qwen2.5-coder:32b"],
      ["provider: runpod-pod", "model: qwen2.5-coder:32b"],
    ]) {
      const resolved = resolveRun([{}, {}, layer(lines), organization()], {
        stage: "code",
        tasks: 1,
      });
      assert.deepEqual(serving(resolved.ok ? resolved.value.settings : undefined), [
        "runpod-pod",
        "qwen2.5-coder:32b",
        "ollama",
        "NVIDIA RTX A6000",
        undefined,
        "run",
      ]);
    }
    const file = layer([
      "provider: runpod-pod",
      "model: qwen3-coder:30b",
      'gpu: "NVIDIA RTX A6000"',
      "pod-reuse: run",
      "profiles:",
      "  - name: bigger-gpu",
      "    when:",
      "      stages: [code]",
      '    gpu: "NVIDIA H100 80GB HBM3"',
      "  - name: other-model",
      "    when:",
      "      stages: [test]",
      "    provider: runpod-pod",
      "    model: qwen2.5-coder:32b",
    ]);
    const run = (stage: ProfileStage) => {
      const resolved = resolveRun([{}, {}, file], { stage, tasks: 1 });
      return serving(resolved.ok ? resolved.value.settings : undefined);
    };
    assert.deepEqual(run("code"), [
      "runpod-pod",
      "qwen3-coder:30b",
      "ollama",
      "NVIDIA H100 80GB HBM3",
      undefined,
      "run",
    ]);
    assert.deepEqual(run("test"), [
      "runpod-pod",
      "qwen2.5-coder:32b",
      "ollama",
      "NVIDIA RTX A6000",
      undefined,
      "run",
    ]);
  });

  test("4. the model always carries over, and only its form is checked", () => {
    const file = layer([
      "provider: runpod-pod",
      "model: qwen3-coder:30b",
      'gpu: "NVIDIA RTX A6000"',
      "profiles:",
      "  - name: planner",
      "    when:",
      "      stages: [plan, route]",
      "    provider: openrouter",
    ]);
    for (const stage of ["plan", "code"] as const) {
      assert.deepEqual(resolveRun([{}, {}, file], { stage, tasks: 1 }), {
        ok: false,
        error:
          "Profile `planner`: With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:30b`.",
      });
    }
    // An OpenRouter ID also has the form of an Ollama name and of a Hugging Face ID.
    const top = ["model: deepseek/deepseek-v4.1-flash", "profiles:", "  - name: gpu", "    when:"];
    for (const [profile, provider] of [
      [["    provider: runpod-pod", '    gpu: "NVIDIA RTX A6000"'], "runpod-pod"],
      [["    provider: runpod-serverless", "    endpoint: abc123xyz"], "runpod-serverless"],
    ] as const) {
      const resolved = resolveRun([{}, {}, layer([...top, "      stages: [code]", ...profile])], {
        stage: "code",
        tasks: 1,
      });
      assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
      assert.deepEqual(
        resolved.ok && [resolved.value.settings.provider, resolved.value.settings.model],
        [provider, "deepseek/deepseek-v4.1-flash"],
      );
    }
  });
});
