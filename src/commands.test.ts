import assert from "node:assert/strict";
import { test } from "node:test";
import { descriptionCommands, parseCommands } from "./commands.ts";
import { isOpenRouterModel } from "./inference/providers.ts";

test("parses approve", () => {
  assert.deepEqual(parseCommands("/codeman approve"), [{ kind: "approve" }]);
  assert.deepEqual(parseCommands("  /CODEMAN   Approve  "), [{ kind: "approve" }]);
});

test("parses decide", () => {
  const [command] = parseCommands("/codeman decide 1=a 2=B 10=c");
  assert.equal(command?.kind, "decide");
  assert.deepEqual(command?.kind === "decide" ? [...command.answers] : [], [
    [1, "a"],
    [2, "b"],
    [10, "c"],
  ]);
});

test("parses set, with model as a shortcut", () => {
  assert.deepEqual(parseCommands("/codeman model deepseek/deepseek-v4.1-flash"), [
    { kind: "set", name: "model", value: "deepseek/deepseek-v4.1-flash" },
  ]);
  assert.deepEqual(
    parseCommands("/codeman set model a/b\n/codeman set task-budget 3.5\n/codeman set max-runs 5"),
    [
      { kind: "set", name: "model", value: "a/b" },
      { kind: "set", name: "task-budget", value: 3.5 },
      { kind: "set", name: "max-runs", value: 5 },
    ],
  );
});

test("reports invalid commands", () => {
  const kinds = [
    "/codeman",
    "/codeman approve now",
    "/codeman decide",
    "/codeman decide 1",
    "/codeman decide a=1",
    "/codeman model",
    "/codeman model a/b c/d",
    "/codeman model $(rm -rf /)",
    "/codeman merge",
    "/codeman set",
    "/codeman set monthly-budget 100",
    "/codeman set max-files 1000",
    "/codeman set task-budget -1",
    "/codeman set task-budget 1e400",
    "/codeman set max-runs 2.5",
    "/codeman set max-runs 2 3",
    "/codeman set model ~a",
    "/codeman set gpu",
    "/codeman set provider runpod-pod",
  ].map((line) => parseCommands(line)[0]?.kind);
  assert.deepEqual(kinds, Array(19).fill("invalid"));
});

test("finds commands among other lines, skipping quotes and code blocks", () => {
  const body = [
    "Looks good.",
    "> /codeman decide 1=b",
    "```",
    "/codeman approve",
    "```",
    "/codeman decide 1=a",
    "text /codeman approve",
    "/codemanapprove",
  ].join("\n");
  const commands = parseCommands(body);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.kind, "decide");
});

test("validates model IDs", () => {
  assert.ok(isOpenRouterModel("deepseek/deepseek-v4.1-flash"));
  assert.ok(isOpenRouterModel("~deepseek/deepseek-flash-latest"));
  assert.ok(isOpenRouterModel("openai/gpt-5:free"));
  assert.ok(!isOpenRouterModel("deepseek"));
  assert.ok(!isOpenRouterModel("a/b/c"));
  assert.ok(!isOpenRouterModel("a/b`c"));
  assert.ok(!isOpenRouterModel(`a/${"b".repeat(100)}`));
});

test("decide accepts `1 a`, `1=a` and mixes of both", () => {
  const answers = (line: string) => {
    const [command] = parseCommands(line);
    return command?.kind === "decide" ? [...command.answers] : command?.kind;
  };
  assert.deepEqual(answers("/codeman decide 1 a"), [[1, "a"]]);
  assert.deepEqual(answers("/codeman decide 1 a 2 B"), [
    [1, "a"],
    [2, "b"],
  ]);
  assert.deepEqual(answers("/codeman decide 1=a 2 b 3=c"), [
    [1, "a"],
    [2, "b"],
    [3, "c"],
  ]);
  assert.equal(answers("/codeman decide 1 a 2"), "invalid");
  assert.equal(answers("/codeman decide 1 ab"), "invalid");
  assert.equal(answers("/codeman decide a 1"), "invalid");
});

test("several decide commands in one comment", () => {
  const commands = parseCommands("/codeman decide 1 a\n/codeman decide 2 b");
  assert.deepEqual(
    commands.map((command) => command.kind),
    ["decide", "decide"],
  );
});

test("answer takes the rest of its line and the following lines", () => {
  const commands = parseCommands(
    [
      "/codeman approve",
      "/codeman answer 2 Use the existing sitemap.",
      "Only update the URLs.",
      "```",
      "/codeman approve",
      "```",
      "/codeman decide 1 b",
      "/codeman answer 3",
      "",
      "On its own lines.",
    ].join("\n"),
  );
  assert.deepEqual(commands[0], { kind: "approve" });
  assert.deepEqual(commands[1], {
    kind: "answer",
    id: 2,
    text: "Use the existing sitemap.\nOnly update the URLs.\n```\n/codeman approve\n```",
  });
  assert.equal(commands[2]?.kind, "decide");
  assert.deepEqual(commands[3], { kind: "answer", id: 3, text: "On its own lines." });
  assert.equal(commands.length, 4);
});

test("approve followed by text is still only approve", () => {
  assert.deepEqual(parseCommands("/codeman approve\nBut keep it small."), [{ kind: "approve" }]);
});

test("answer needs a number and text", () => {
  assert.equal(parseCommands("/codeman answer")[0]?.kind, "invalid");
  assert.equal(parseCommands("/codeman answer two text")[0]?.kind, "invalid");
  assert.equal(parseCommands("/codeman answer 2")[0]?.kind, "invalid");
  assert.equal(parseCommands(`/codeman answer 2 ${"x".repeat(2001)}`)[0]?.kind, "invalid");
});

test("replan takes optional text", () => {
  assert.deepEqual(parseCommands("/codeman replan"), [{ kind: "replan", text: "" }]);
  assert.deepEqual(parseCommands("/codeman replan Split step 2.\nAnd drop step 4."), [
    { kind: "replan", text: "Split step 2.\nAnd drop step 4." },
  ]);
});

test("fix and continue take optional text", () => {
  assert.deepEqual(parseCommands("/codeman fix Rename the endpoint.\nAlso update docs."), [
    { kind: "fix", text: "Rename the endpoint.\nAlso update docs." },
  ]);
  assert.deepEqual(parseCommands("/codeman continue\n/codeman FIX"), [
    { kind: "continue", text: "" },
    { kind: "fix", text: "" },
  ]);
});

test("accept-workflows takes no arguments", () => {
  assert.deepEqual(parseCommands("/codeman accept-workflows"), [{ kind: "accept-workflows" }]);
  assert.equal(parseCommands("/codeman accept-workflows all")[0]?.kind, "invalid");
});

test("a task can set its language, and a bad one is a problem to render", () => {
  assert.deepEqual(parseCommands("/codeman set language pt-BR"), [
    { kind: "set", name: "language", value: "pt-BR" },
  ]);
  assert.deepEqual(parseCommands("/codeman set language portuguese!")[0], {
    kind: "invalid",
    text: "/codeman set language portuguese!",
    problem: { kind: "invalid-setting", name: "language", type: "language" },
  });
});

test("reads settings in a description and removes command lines from its text", () => {
  const body = [
    "Add rate limiting.",
    "/codeman model a/b",
    "  /codeman set task-budget 5",
    "",
    "```",
    "/codeman set max-runs 9",
    "```",
    "/codeman approve",
    "Keep the defaults.",
  ].join("\n");
  const { commands, text } = descriptionCommands(body);
  assert.deepEqual(commands, [
    { kind: "set", name: "model", value: "a/b" },
    { kind: "set", name: "task-budget", value: 5 },
    {
      kind: "invalid",
      text: "/codeman approve",
      problem: { kind: "not-in-description" },
    },
  ]);
  assert.equal(text, "Add rate limiting.\n\n```\n/codeman set max-runs 9\n```\nKeep the defaults.");
});

test("reports an invalid setting in a description", () => {
  const { commands, text } = descriptionCommands("/codeman set max-runs 0");
  assert.deepEqual(commands, [
    {
      kind: "invalid",
      text: "/codeman set max-runs 0",
      problem: { kind: "invalid-setting", name: "max-runs", type: "integer" },
    },
  ]);
  assert.equal(text, "");
});

test("keeps a description without commands as it is", () => {
  assert.deepEqual(descriptionCommands("Fix the /codeman docs.\n"), {
    commands: [],
    text: "Fix the /codeman docs.",
  });
});

test("a GPU takes the rest of the line, since its name has spaces", () => {
  assert.deepEqual(parseCommands("/codeman set gpu NVIDIA GeForce RTX 4090"), [
    { kind: "set", name: "gpu", value: "NVIDIA GeForce RTX 4090" },
  ]);
  assert.deepEqual(parseCommands("/codeman set provider runpod-pod")[0], {
    kind: "invalid",
    text: "/codeman set provider runpod-pod",
    problem: {
      kind: "set-which",
      names: ["model", "task-budget", "max-runs", "language", "gpu"],
    },
  });
});

test("an old name is a problem that gives the new one", () => {
  assert.deepEqual(parseCommands("/codeman set gpu-type NVIDIA RTX A5000")[0], {
    kind: "invalid",
    text: "/codeman set gpu-type NVIDIA RTX A5000",
    problem: { kind: "renamed-setting", name: "gpu-type", now: "gpu" },
  });
  assert.deepEqual(descriptionCommands("/codeman set gpu-type NVIDIA RTX A5000").commands, [
    {
      kind: "invalid",
      text: "/codeman set gpu-type NVIDIA RTX A5000",
      problem: { kind: "renamed-setting", name: "gpu-type", now: "gpu" },
    },
  ]);
});
