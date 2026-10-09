import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PROVIDERS } from "./inference/providers.ts";
import {
  applies,
  DEFAULTS,
  isSettingName,
  MAX_TASKS,
  type PartialSettings,
  parseSetting,
  parseSettings,
  resolveRun,
  resolveSettings,
  type Settings,
  SHARED_SETTINGS,
  servedCounts,
  settingSources,
  TASK_SETTINGS,
  tasksPerRun,
} from "./settings.ts";
import { STAGES, type Stage } from "./stages.ts";
import { exampleSettings } from "./testing/settings-example.ts";

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

test("no setting is required: without a model, the top level serves no agent run", () => {
  const resolved = resolveSettings({}, {}, {});
  assert.deepEqual(resolved, { ok: true, value: { ...DEFAULTS, model: "" } });
  assert.deepEqual(resolveRun([{}, {}, {}], { stage: "plan", tasks: 1 }), {
    ok: false,
    error:
      "No settings apply to the `plan` stage with 1 task(s): no profile does, and the top-level settings have no `model`.",
  });
  // Without a model, the top level is checked for what its provider accepts, not requires.
  const pod = resolveSettings({}, {}, { provider: "runpod-pod" });
  assert.ok(pod.ok && pod.value.model === "" && pod.value.engine === "ollama");
  assert.deepEqual(resolveSettings({}, {}, { gpu: "G" }), {
    ok: false,
    error: "`openrouter` does not accept `gpu`; it takes only `model`.",
  });
  // A profile that inherits no model sets its own.
  const file = parseSettings("profiles:\n  - name: planner\n    stages: [plan]");
  assert.ok(file.ok);
  assert.deepEqual(resolveRun([{}, {}, file.ok ? file.value : {}], { stage: "code", tasks: 1 }), {
    ok: false,
    error:
      "Profile `planner` has no `model`, and the top-level settings have none to inherit: set one in the profile.",
  });
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

test("a run takes as many tasks as the profiles' counts allow, and one without them", () => {
  const counts = (...profiles: string[]) => {
    const file = parseSettings(["model: a/b", "profiles:", ...profiles].join("\n"));
    assert.ok(file.ok, file.ok ? "" : file.error);
    return tasksPerRun([{}, {}, file.ok ? file.value : {}]);
  };
  assert.equal(tasksPerRun([{}, {}, { model: "a/b" }]), 1, "no profiles");
  assert.equal(counts("  - name: a", "    stages: [plan]"), 1, "no count condition");
  assert.equal(counts("  - name: a", "    tasks: 4", "  - name: b", "    max-tasks: 3"), 4);
  assert.equal(counts("  - name: a", "    min-tasks: 2", "    max-tasks: 5"), 5);
  assert.equal(counts("  - name: a", "    min-tasks: 2"), MAX_TASKS, "Codeman's cap");
  assert.equal(MAX_TASKS, 10);
  // The repository's list replaces the organization's whole, its counts too.
  const shared = parseSettings("profiles:\n  - name: wide\n    max-tasks: 8\n    model: a/b");
  assert.ok(shared.ok);
  const organization = shared.ok ? shared.value : {};
  assert.equal(tasksPerRun([{}, {}, organization]), 8);
  assert.equal(tasksPerRun([{}, {}, { profiles: [] }, organization]), 1);
});

test("conditions sit at the profile's first level, and hold for the run's count", () => {
  const profile = (...lines: string[]) => {
    const file = parseSettings(["profiles:", "  - name: p", ...lines, "    model: a/b"].join("\n"));
    assert.ok(file.ok, file.ok ? "" : file.error);
    const [first] = file.ok ? (file.value.profiles ?? []) : [];
    assert.ok(first);
    return first;
  };
  const holds = (found: ReturnType<typeof profile>, stage: Stage, tasks: number) =>
    applies(found, { stage, tasks });
  const exact = profile("    tasks: 4");
  assert.deepEqual(exact.conditions, { tasks: 4 });
  assert.deepEqual(
    [1, 3, 4, 5].map((tasks) => holds(exact, "code", tasks)),
    [false, false, true, false],
  );
  const upTo = profile("    stages: [code, test]", "    max-tasks: 3");
  assert.deepEqual(
    [1, 3, 4].map((tasks) => holds(upTo, "code", tasks)),
    [true, true, false],
  );
  assert.equal(holds(upTo, "plan", 1), false, "another stage");
  const range = profile("    min-tasks: 2", "    max-tasks: 3");
  assert.deepEqual(
    [1, 2, 3, 4].map((tasks) => holds(range, "review", tasks)),
    [false, true, true, false],
  );
  const atLeast = profile("    min-tasks: 2");
  assert.deepEqual(
    [1, 2, 10].map((tasks) => holds(atLeast, "web", tasks)),
    [false, true, true],
  );
  const always = profile();
  assert.deepEqual(always.conditions, {});
  assert.ok(
    STAGES.every((stage) => holds(always, stage, 7)),
    "every stage, any count",
  );
});

test("the counts at which a stage is served, and by what", () => {
  const layers = (lines: string[]) => {
    const file = parseSettings(lines.join("\n"));
    assert.ok(file.ok, file.ok ? "" : file.error);
    return [{}, {}, file.ok ? file.value : {}];
  };
  const pods = layers([
    "profiles:",
    "  - name: four",
    "    stages: [code]",
    "    tasks: 4",
    "    model: a/b",
    "  - name: up-to-two",
    "    stages: [code]",
    "    max-tasks: 2",
    "    model: c/d",
  ]);
  assert.deepEqual(servedCounts(pods, "code"), {
    ok: true,
    value: [
      { tasks: 1, profile: "up-to-two" },
      { tasks: 2, profile: "up-to-two" },
      { tasks: 4, profile: "four" },
    ],
  });
  assert.deepEqual(servedCounts(pods, "plan"), { ok: true, value: [] }, "nothing serves it");
  // A top level with a model serves every count no profile does.
  const top = layers(["model: e/f", "profiles:", "  - name: four", "    tasks: 4"]);
  const served = servedCounts(top, "plan");
  assert.ok(served.ok);
  assert.deepEqual(served.ok ? served.value.map((count) => count.profile ?? "top") : [], [
    "top",
    "top",
    "top",
    "four",
    "top",
    "top",
    "top",
    "top",
    "top",
    "top",
  ]);
  // A task's model gives the top level one, for the top level's provider.
  const own = servedCounts([{ model: "g/h" }, {}, pods[2] ?? {}], "plan");
  assert.ok(own.ok && own.value.length === MAX_TASKS);
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
  // Conditions belong to profiles, at their first level; `when` and `parallel-tasks` are gone.
  const conditions: [string, string][] = [
    [
      "model: a/b\nwhen:\n  stages: [plan]",
      "line 2: `when` is gone, and conditions belong to profiles: write them in a profile, under `profiles`, beside its `name`. The top-level settings apply when no profile does.",
    ],
    ...(["stages: [plan]", "tasks: 2", "min-tasks: 2", "max-tasks: 2"] as const).map(
      (text): [string, string] => [
        `model: a/b\n${text}`,
        `line 2: \`${text.split(":")[0]}\` is a profile's condition: write it in a profile, under \`profiles\`. The top-level settings apply when no profile does.`,
      ],
    ),
    [
      "model: a/b\nparallel-tasks: 3",
      "line 2: `parallel-tasks` is no longer a setting: a run takes as many tasks as its profiles' `tasks`, `min-tasks` and `max-tasks` allow, and one at a time when none sets them. For up to 3 tasks at once, write `max-tasks: 3` in a profile.",
    ],
    [
      "profiles:\n  - name: a\n    when:\n      stages: [plan]",
      "line 3: `when` is gone: write the profile's conditions (`stages`, `tasks`, `min-tasks`, `max-tasks`) directly in the profile, beside its `name`.",
    ],
    [
      "profiles:\n  - name: a\n    when: plan",
      "line 3: `when` is gone: write the profile's conditions",
    ],
    [
      "profiles:\n  - name: a\n    parallel-tasks: 2",
      "line 3: `parallel-tasks` is no longer a condition: write `min-tasks: 2` for at least 2 tasks in the run, or `tasks: 2` for exactly 2.",
    ],
  ];
  for (const [text, error] of conditions) {
    const parsed = parseSettings(text);
    assert.ok(!parsed.ok && parsed.error.startsWith(`.codeman/settings.yml, ${error}`), text);
  }
  assert.deepEqual(parseSettings("parallel-tasks: 2", SHARED_SETTINGS), {
    ok: false,
    error: `${SHARED_SETTINGS}, line 1: \`parallel-tasks\` is no longer a setting: a run takes as many tasks as its profiles' \`tasks\`, \`min-tasks\` and \`max-tasks\` allow, and one at a time when none sets them. For up to 2 tasks at once, write \`max-tasks: 2\` in a profile.`,
  });
  assert.equal(parseSetting("max-runs", "2").ok, true);
  assert.ok(!isSettingName("parallel-tasks"), "no longer a setting");

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
      "    stages: [route, code, test]",
      "    min-tasks: 2                      # when the run has at least 2 tasks",
      "    max-tasks: 4",
      "    provider: runpod-pod",
      "    gpu: NVIDIA RTX A6000",
      "    model: qwen3-coder:30b",
      "",
      "  # A block list of stages reads as the brackets do.",
      "  - name: coder",
      "    stages:",
      "      - code",
      "      - 'test'",
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
          conditions: { stages: ["route", "code", "test"], "min-tasks": 2, "max-tasks": 4 },
          settings: {
            provider: "runpod-pod",
            gpu: "NVIDIA RTX A6000",
            model: "qwen3-coder:30b",
          },
        },
        {
          name: "coder",
          conditions: { stages: ["code", "test"] },
          settings: { model: "qwen/qwen3-coder" },
        },
      ],
      "max-runs": 4,
    },
  });
  const sameIndent = parseSettings(
    "model: a/b\nprofiles:\n- name: planner\n  stages: [plan]\n  model: c/d\nmax-runs: 2",
  );
  assert.deepEqual(sameIndent, {
    ok: true,
    value: {
      model: "a/b",
      profiles: [{ name: "planner", conditions: { stages: ["plan"] }, settings: { model: "c/d" } }],
      "max-runs": 2,
    },
  });
  assert.deepEqual(parseSettings("profiles: []"), { ok: true, value: { profiles: [] } });
  const flowMapping = parseSettings("profiles:\n  - name: a\n    stages: {code: 1}");
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
    [
      "profiles:\n  - name: a\n    stages: [deploy]",
      "line 3: `stages` must list some of the stages `plan`, `route`, `web`",
    ],
    ["profiles:\n  - name: a\n    stages: []", "line 3: `stages` must list"],
    ["profiles:\n  - name: a\n    stages: code", "line 3: `stages` must list"],
    [
      "profiles:\n  - name: a\n    tasks: 0",
      "line 3: `tasks` must be a whole number from 1 to 10: the tasks of the run that run an agent.",
    ],
    ["profiles:\n  - name: a\n    max-tasks: 11", "line 3: `max-tasks` must be a whole number"],
    ["profiles:\n  - name: a\n    min-tasks: 1.5", "line 3: `min-tasks` must be a whole number"],
    ["profiles:\n  - name: a\n    tasks: [2]", "line 3: `tasks` must be a whole number"],
    [
      "profiles:\n  - name: a\n    tasks: 4\n    max-tasks: 4",
      "line 2: `tasks` is an exact count: write it alone, or `min-tasks` and `max-tasks` for a range.",
    ],
    ["profiles:\n  - name: a\n    min-tasks: 2\n    tasks: 4", "line 2: `tasks` is an exact count"],
    [
      "profiles:\n  - name: a\n    min-tasks: 4\n    max-tasks: 3",
      "line 2: `min-tasks` must not be more than `max-tasks`.",
    ],
    ["profiles:\n  - name: a\n    labels: [x]", "line 3: unknown setting `labels`."],
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
      "    min-tasks: 2",
      "    model: deepseek/deepseek-v4.1-flash",
      "  - name: planner",
      "    stages: [plan, route]",
      "    model: openai/gpt-5",
      "  - name: small-pod",
      "    stages: [code, test]",
      "    provider: runpod-pod",
      "    gpu: NVIDIA RTX A6000",
      "    model: qwen3-coder:30b",
      "  - name: reviewer",
      "    stages: [review]",
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
  const run = (stage: Stage, tasks = 1) => {
    const resolved = resolveRun(layers, { stage, tasks });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    return resolved.ok ? resolved.value : undefined;
  };
  assert.deepEqual(
    STAGES.map((stage) => [stage, run(stage)?.profile, run(stage)?.settings.model]),
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
      "    stages: [review]",
      "    provider: runpod-serverless",
      "    endpoint: https://api.runpod.ai/v2/abc123/run",
      "    model: Qwen/Qwen3-Coder-30B-A3B-Instruct",
      "  - name: planner",
      "    stages: [plan]",
      "    provider: openrouter",
      "    model: openai/gpt-5",
      "  - name: big-pod",
      "    stages: [code]",
      "    gpu: NVIDIA A100 80GB PCIe",
    ].join("\n"),
  );
  assert.ok(file.ok, file.ok ? "" : file.error);
  const layers = [{}, {}, file.ok ? file.value : {}];
  const settings = (stage: Stage) => {
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
    "model: a/b\nprofiles:\n  - name: planner\n    stages: [plan]\n    gpu: GPU",
  );
  const resolved = resolveRun([{}, {}, wrong.ok ? wrong.value : {}], { stage: "code", tasks: 1 });
  assert.deepEqual(resolved, {
    ok: false,
    error: "Profile `planner`: `openrouter` does not accept `gpu`; it takes only `model`.",
  });
});

test("a layer on another provider leaves out the provider settings it inherits", () => {
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

test("a task's model applies to the runs on the top level's provider, and must fit it", () => {
  const layers = profiled({ model: "deepseek/deepseek-v4.1-flash", "task-budget": 5 });
  const run = (stage: Stage) => {
    const resolved = resolveRun(layers, { stage, tasks: 1 });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    return resolved.ok ? [resolved.value.profile, resolved.value.settings.model] : [];
  };
  // It overrides a profile on the same provider, and never reaches one on another provider.
  assert.deepEqual(run("web"), [undefined, "deepseek/deepseek-v4.1-flash"]);
  assert.deepEqual(run("plan"), ["planner", "deepseek/deepseek-v4.1-flash"]);
  assert.deepEqual(run("code"), ["small-pod", "qwen3-coder:30b"]);
  assert.deepEqual(run("review"), ["reviewer", "Qwen/Qwen3-Coder-30B-A3B-Instruct"]);
  const code = resolveRun(layers, { stage: "code", tasks: 1 });
  assert.equal(code.ok && code.value.settings["task-budget"], 5);
  // One that does not fit the top level's provider is an error on every run, which `select`
  // reports, going on without it.
  for (const stage of ["plan", "code"] as const) {
    const pod = resolveRun(profiled({ model: "qwen3-coder:480b" }), { stage, tasks: 1 });
    assert.deepEqual(pod, {
      ok: false,
      error:
        "The task's `model` is for `openrouter`, the top-level settings' provider. With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:480b`.",
    });
  }
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
    "model: a/b\nprofiles:\n  - name: pods\n    stages: [code]\n    provider: runpod-pod\n    model: qwen3-coder:30b",
  );
  assert.ok(file.ok);
  const resolved = resolveRun([{}, {}, file.ok ? file.value : {}], { stage: "plan", tasks: 1 });
  assert.ok(!resolved.ok && resolved.error.startsWith("Profile `pods`: `runpod-pod` needs `gpu`"));
});

test("the repository's profiles replace the organization's whole, and the log names them", () => {
  const shared = parseSettings(
    "model: org/model\nprofiles:\n  - name: org-plan\n    stages: [plan]\n    model: org/planner",
    SHARED_SETTINGS,
  );
  const file = parseSettings(
    "profiles:\n  - name: repo-code\n    stages: [code]\n    model: repo/coder",
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

test("a layer or profile that changes provider must set its own model", () => {
  const code = { stage: "code", tasks: 1 } as const;
  const pods = (profile: string[]) =>
    parseSettings(
      [
        "model: deepseek/deepseek-v4.1-flash",
        "profiles:",
        "  - name: small-pod",
        "    stages: [code]",
        ...profile,
      ].join("\n"),
    );
  const pod = ["    provider: runpod-pod", '    gpu: "NVIDIA RTX A6000"'];
  const without = pods(pod);
  assert.ok(without.ok);
  const error =
    "Profile `small-pod` names `runpod-pod`, but inherits `openrouter` from the top level, so it must set its own `model`, one for `runpod-pod`.";
  // Whichever stage runs, and even when the task sets a model.
  for (const own of [{}, { model: "qwen3-coder:30b" }]) {
    for (const stage of ["plan", "code"] as const) {
      assert.deepEqual(
        resolveRun([own, {}, without.ok ? without.value : {}], { stage, tasks: 1 }),
        {
          ok: false,
          error,
        },
      );
    }
  }
  const own = pods([...pod, "    model: qwen3-coder:30b"]);
  const fine = resolveRun([{}, {}, own.ok ? own.value : {}], code);
  assert.ok(fine.ok && fine.value.settings.model === "qwen3-coder:30b");
  // No provider, or the same one, inherits the model.
  for (const profile of [[], ["    provider: openrouter"]]) {
    const same = parseSettings(
      ["model: deepseek/deepseek-v4.1-flash", "profiles:", "  - name: same", ...profile].join("\n"),
    );
    const resolved = resolveRun([{}, {}, same.ok ? same.value : {}], code);
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    assert.deepEqual(resolved.ok && [resolved.value.profile, resolved.value.settings.model], [
      "same",
      "deepseek/deepseek-v4.1-flash",
    ]);
  }

  // A repository's file that overrides the organization's provider, or the default `openrouter`.
  const file = { provider: "runpod-pod", gpu: "NVIDIA RTX A6000" } as const;
  const organization = parseSettings("model: deepseek/deepseek-v4.1-flash", SHARED_SETTINGS);
  assert.ok(organization.ok);
  const shared = organization.ok ? organization.value : {};
  const fileError =
    ".codeman/settings.yml names `runpod-pod`, but inherits `openrouter` from Codeman's default, so it must set its own `model`, one for `runpod-pod`.";
  assert.deepEqual(resolveRun([{}, {}, file, shared], code), { ok: false, error: fileError });
  // A manual run's model does not make up for it: scheduled runs have none.
  assert.deepEqual(resolveRun([{}, { model: "qwen3-coder:30b" }, file, shared], code), {
    ok: false,
    error: fileError,
  });
  const set = resolveRun([{}, {}, { ...file, model: "qwen3-coder:30b" }, shared], code);
  assert.ok(set.ok && set.value.settings.model === "qwen3-coder:30b");
  // With no model inherited, none carries over: a layer that inherits the change sets it.
  const noModel = parseSettings('provider: runpod-pod\ngpu: "NVIDIA RTX A6000"', SHARED_SETTINGS);
  assert.ok(noModel.ok);
  for (const layers of [
    [{}, {}, { model: "qwen3-coder:30b" }, noModel.ok ? noModel.value : {}],
    [{}, { model: "qwen3-coder:30b" }, file],
  ]) {
    const resolved = resolveRun(layers, code);
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    assert.deepEqual(
      resolved.ok && [resolved.value.settings.provider, resolved.value.settings.model],
      ["runpod-pod", "qwen3-coder:30b"],
    );
  }
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

  test("1. a profile that switches provider starts without the provider settings it inherits", () => {
    const file = layer([
      "provider: runpod-pod",
      "model: qwen3-coder:30b",
      'gpu: "NVIDIA RTX A6000"',
      "profiles:",
      "  - name: serverless-review",
      "    stages: [review]",
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
    // Without its own model, the organization's would carry over: the file must set one.
    const alone = resolveRun([{}, {}, layer(["provider: openrouter"]), organization()], {
      stage: "code",
      tasks: 1,
    });
    assert.deepEqual(alone, {
      ok: false,
      error:
        ".codeman/settings.yml names `openrouter`, but inherits `runpod-pod` from the organization's settings, so it must set its own `model`, one for `openrouter`.",
    });
  });

  test("3. no provider, or the same one, keeps the provider settings it inherits", () => {
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
      "    stages: [code]",
      '    gpu: "NVIDIA H100 80GB HBM3"',
      "  - name: other-model",
      "    stages: [test]",
      "    provider: runpod-pod",
      "    model: qwen2.5-coder:32b",
    ]);
    const run = (stage: Stage) => {
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

  test("4. a profile that changes provider must set its own model", () => {
    const file = layer([
      "provider: runpod-pod",
      "model: qwen3-coder:30b",
      'gpu: "NVIDIA RTX A6000"',
      "profiles:",
      "  - name: planner",
      "    stages: [plan, route]",
      "    provider: openrouter",
    ]);
    for (const stage of ["plan", "code"] as const) {
      assert.deepEqual(resolveRun([{}, {}, file], { stage, tasks: 1 }), {
        ok: false,
        error:
          "Profile `planner` names `openrouter`, but inherits `runpod-pod` from the top level, so it must set its own `model`, one for `openrouter`.",
      });
    }
    // The other way round too, though an OpenRouter ID has the form of an Ollama name and of a
    // Hugging Face ID.
    const top = ["model: deepseek/deepseek-v4.1-flash", "profiles:", "  - name: gpu"];
    for (const [profile, provider] of [
      [["    provider: runpod-pod", '    gpu: "NVIDIA RTX A6000"'], "runpod-pod"],
      [["    provider: runpod-serverless", "    endpoint: abc123xyz"], "runpod-serverless"],
    ] as const) {
      const resolved = resolveRun([{}, {}, layer([...top, "    stages: [code]", ...profile])], {
        stage: "code",
        tasks: 1,
      });
      assert.deepEqual(resolved, {
        ok: false,
        error: `Profile \`gpu\` names \`${provider}\`, but inherits \`openrouter\` from the top level, so it must set its own \`model\`, one for \`${provider}\`.`,
      });
    }
  });
});

// The responsible person's example, as docs/settings/profiles.md shows it.
test("the example: planning on OpenRouter, 4 tasks on a full GPU or up to 3 on a MIG partition", () => {
  const file = parseSettings(exampleSettings());
  assert.ok(file.ok, file.ok ? "" : file.error);
  const layers = [{}, {}, file.ok ? file.value : {}];
  assert.equal(tasksPerRun(layers), 4);
  const run = (stage: Stage, tasks: number) => {
    const resolved = resolveRun(layers, { stage, tasks });
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.error);
    const settings = resolved.ok ? resolved.value.settings : undefined;
    return [resolved.ok && resolved.value.profile, settings?.provider, settings?.gpu];
  };
  for (const tasks of [1, 4]) {
    assert.deepEqual(run("plan", tasks), ["planner", "openrouter", undefined]);
  }
  const mig = "NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb";
  for (const stage of ["route", "code", "review"] as const) {
    assert.deepEqual(run(stage, 3), ["mig", "runpod-pod", mig]);
    assert.deepEqual(run(stage, 4), [
      "parallel-tasks",
      "runpod-pod",
      "NVIDIA RTX PRO 6000 Blackwell Server Edition",
    ]);
  }
  const code = servedCounts(layers, "code");
  assert.deepEqual(code.ok && code.value.map((count) => [count.tasks, count.profile]), [
    [1, "mig"],
    [2, "mig"],
    [3, "mig"],
    [4, "parallel-tasks"],
  ]);
  // No top-level model: the runs without an agent need none.
  const top = resolveSettings(...layers);
  assert.ok(top.ok && top.value.model === "" && top.value["task-budget"] === 2);
  // Without `review` in the pod profiles, nothing serves review at any count.
  const noReview = parseSettings(
    exampleSettings().replaceAll(
      "stages: [route, web, design, code, test, review]",
      "stages: [route, web, design, code, test]",
    ),
  );
  assert.ok(noReview.ok);
  assert.deepEqual(servedCounts([{}, {}, noReview.ok ? noReview.value : {}], "review"), {
    ok: true,
    value: [],
  });
});
