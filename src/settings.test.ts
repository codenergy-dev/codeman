import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, parseSettings, resolveSettings } from "./settings.ts";

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
