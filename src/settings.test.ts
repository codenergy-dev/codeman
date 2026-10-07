import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULTS,
  type PartialSettings,
  PROFILE_STAGES,
  type ProfileStage,
  parseSetting,
  parseSettings,
  resolveRun,
  resolveSettings,
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

test("reads inference profiles: a list of blocks, with conditions", () => {
  const valid = parseSettings(
    [
      "model: anthropic/claude-sonnet-4.5     # the default profile",
      "inference-profiles:",
      "  - name: small-pod",
      "    when:",
      "      stages: [route, code, test]",
      "      parallel-tasks: 2                 # when the run has at least 2 tasks",
      "    inference: self-hosted",
      "    gpu-mode: pod",
      "    gpu-type: NVIDIA RTX A6000",
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
      "inference-profiles": [
        {
          name: "small-pod",
          when: { stages: ["route", "code", "test"], "parallel-tasks": 2 },
          settings: {
            inference: "self-hosted",
            "gpu-mode": "pod",
            "gpu-type": "NVIDIA RTX A6000",
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
    "model: a/b\ninference-profiles:\n- name: planner\n  when:\n    stages: [plan]\n  model: c/d\nmax-runs: 2",
  );
  assert.deepEqual(sameIndent, {
    ok: true,
    value: {
      model: "a/b",
      "inference-profiles": [
        { name: "planner", when: { stages: ["plan"] }, settings: { model: "c/d" } },
      ],
      "max-runs": 2,
    },
  });
  assert.deepEqual(parseSettings("inference-profiles: []"), {
    ok: true,
    value: { "inference-profiles": [] },
  });
  const flowMapping = parseSettings("inference-profiles:\n  - name: a\n    when: {stages: [plan]}");
  assert.ok(!flowMapping.ok && flowMapping.error.includes("line 3"), "not in the subset");
});

test("rejects malformed profiles, naming the line", () => {
  const cases: [string, string][] = [
    ["inference-profiles:\n  - model: a/b", "line 2: a profile needs a `name`."],
    [
      "inference-profiles:\n  - name: a\n    task-budget: 5",
      "line 3: a profile cannot set `task-budget`; it sets only `inference`, `gpu-provider`, `gpu-mode`, `gpu-type`, `engine`, `serverless-endpoint`, `pod-reuse`, `model`.",
    ],
    ["inference-profiles:\n  - name: a\n    secret: x", "line 3: unknown setting `secret`."],
    ["inference-profiles:\n  - name: a\n    gpu-mode: spot", "line 3: `gpu-mode` must be one of"],
    ["inference-profiles:\n  - name: a\n  - name: a", "line 3: two profiles are named `a`."],
    ["inference-profiles:\n  - name: a b", "line 2: a profile's `name` must be"],
    [
      "inference-profiles:\n  - name: a\n    when:\n      stages: [deploy]",
      "line 4: `stages` must list",
    ],
    ["inference-profiles:\n  - name: a\n    when:\n      stages: []", "line 4: `stages` must list"],
    [
      "inference-profiles:\n  - name: a\n    when:\n      parallel-tasks: 0",
      "line 4: `parallel-tasks` must",
    ],
    [
      "inference-profiles:\n  - name: a\n    when:\n      labels: [x]",
      "line 4: unknown condition `labels`",
    ],
    ["inference-profiles:\n  - name: a\n    when: plan", "line 3: `when` must be a block"],
    ["inference-profiles: [a, b]", "line 1: `inference-profiles` must be a list of profiles"],
    ["inference-profiles:\n  - a", "line 2: `inference-profiles` must be a list of profiles"],
    ["inference-profiles:", "line 1: `inference-profiles` must be a list of profiles"],
    ["inference-profiles:\n  - name: a\n     model: b/c", "line 3: unexpected indentation."],
    ["inference-profiles:\n  - name: a\n   model: b/c", "line 3: unexpected indentation."],
    ["inference-profiles:\n  -\n    name: a", "line 2: expected a value after `-`"],
    ["inference-profiles:\n  - - name: a", "line 2: a list item cannot be a list."],
    ["inference-profiles:\n\t- name: a", "line 2: indent with spaces, not tabs."],
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
  // Its profile, once uncommented, reads too.
  const profile = parseSettings(text.replace(/^# (?=inference-profiles:| {2})/gm, ""));
  assert.ok(profile.ok && profile.value["inference-profiles"]?.[0]?.name === "small-pod");
  assert.deepEqual(parseSettings("gpu-type: \"NVIDIA RTX A6000\"\nmodel: '~a/b' # latest"), {
    ok: true,
    value: { "gpu-type": "NVIDIA RTX A6000", model: "~a/b" },
  });
  // A plain value of several words, as YAML reads it.
  assert.deepEqual(parseSettings("gpu-type: NVIDIA RTX  A6000 # two spaces"), {
    ok: true,
    value: { "gpu-type": "NVIDIA RTX  A6000" },
  });
});

/** The plan's example, with a profile per stage and the default for the others. */
function profiled(extra: PartialSettings = {}) {
  const file = parseSettings(
    [
      "model: anthropic/claude-sonnet-4.5",
      "inference-profiles:",
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
      "    inference: self-hosted",
      "    gpu-type: NVIDIA RTX A6000",
      "    model: qwen3-coder:30b",
      "  - name: reviewer",
      "    when:",
      "      stages: [review]",
      "    inference: self-hosted",
      "    gpu-mode: serverless",
      "    serverless-endpoint: abc123",
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
  assert.equal(pod?.inference, "self-hosted");
  assert.equal(pod?.engine, "ollama");
  assert.equal(run("review")?.settings.engine, "vllm", "the mode's engine, not the top level's");
  assert.equal(run("web")?.settings.inference, "openrouter");
  assert.equal(run("code", 2)?.profile, "crowded", "first in the file's order");
  assert.deepEqual(run("plan")?.providers, ["openrouter", "runpod"]);
  // Without a run, as for recording answers, no profile applies.
  const top = resolveSettings(...layers);
  assert.ok(top.ok && top.value.model === "anthropic/claude-sonnet-4.5");
  assert.ok(top.ok && !("inference-profiles" in top.value));
});

test("a task's model wins over the profile, and must fit its inference", () => {
  const layers = profiled({ model: "qwen3-coder:480b", "task-budget": 5 });
  const code = resolveRun(layers, { stage: "code", tasks: 1 });
  assert.ok(code.ok);
  assert.equal(code.ok && code.value.settings.model, "qwen3-coder:480b");
  assert.equal(code.ok && code.value.settings["task-budget"], 5);
  assert.equal(code.ok && code.value.profile, "small-pod");
  const plan = resolveRun(layers, { stage: "plan", tasks: 1 });
  assert.ok(!plan.ok && plan.error.startsWith("Inference profile `planner`: `model` must be"));
});

test("every profile must fit with the top-level settings, whichever stage runs", () => {
  const file = parseSettings(
    "model: a/b\ninference-profiles:\n  - name: pods\n    when:\n      stages: [code]\n    inference: self-hosted\n    model: qwen3-coder:30b",
  );
  assert.ok(file.ok);
  const resolved = resolveRun([{}, {}, file.ok ? file.value : {}], { stage: "plan", tasks: 1 });
  assert.ok(
    !resolved.ok &&
      resolved.error.startsWith(
        "Inference profile `pods`: Self-hosted inference on pods needs `gpu-type`",
      ),
  );
});

test("the repository's profiles replace the organization's whole, and the log names them", () => {
  const shared = parseSettings(
    "model: org/model\ninference-profiles:\n  - name: org-plan\n    when:\n      stages: [plan]\n    model: org/planner",
    SHARED_SETTINGS,
  );
  const file = parseSettings(
    "inference-profiles:\n  - name: repo-code\n    when:\n      stages: [code]\n    model: repo/coder",
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
    "Settings from .codeman/settings.yml: inference-profiles=[repo-code].",
    `Settings from ${SHARED_SETTINGS}: model=org/model.`,
  ]);
  // A file without profiles keeps the organization's; `[]` removes them.
  const kept = resolveRun([{}, {}, {}, shared.value], { stage: "plan", tasks: 1 });
  assert.ok(kept.ok && kept.value.profile === "org-plan");
  const none = parseSettings("inference-profiles: []");
  const removed = resolveRun([{}, {}, none.ok ? none.value : {}, shared.value], {
    stage: "plan",
    tasks: 1,
  });
  assert.ok(removed.ok && removed.value.profile === undefined);
});
