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
