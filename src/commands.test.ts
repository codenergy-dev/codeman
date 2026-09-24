import assert from "node:assert/strict";
import { test } from "node:test";
import { isModelId, parseCommands } from "./commands.ts";

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

test("parses model", () => {
  assert.deepEqual(parseCommands("/codeman model deepseek/deepseek-v4.1-flash"), [
    { kind: "model", model: "deepseek/deepseek-v4.1-flash" },
  ]);
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
  ].map((line) => parseCommands(line)[0]?.kind);
  assert.deepEqual(kinds, Array(9).fill("invalid"));
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
  assert.ok(isModelId("deepseek/deepseek-v4.1-flash"));
  assert.ok(isModelId("~deepseek/deepseek-flash-latest"));
  assert.ok(isModelId("openai/gpt-5:free"));
  assert.ok(!isModelId("deepseek"));
  assert.ok(!isModelId("a/b/c"));
  assert.ok(!isModelId("a/b`c"));
  assert.ok(!isModelId(`a/${"b".repeat(100)}`));
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
