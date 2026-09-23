import assert from "node:assert/strict";
import { test } from "node:test";
import { stateLabel, stateOf } from "./state.ts";

test("a task without a state label is new", () => {
  assert.deepEqual(stateOf(["codeman", "bug"]), { ok: true, state: "new" });
});

test("reads the single state label", () => {
  assert.deepEqual(stateOf(["codeman", "codeman:awaiting-decision"]), {
    ok: true,
    state: "awaiting-decision",
  });
});

test("rejects more than one state label", () => {
  const result = stateOf(["codeman", "codeman:ready", "codeman:blocked"]);
  assert.deepEqual(result, {
    ok: false,
    error: "multiple state labels: codeman:ready, codeman:blocked",
  });
});

test("ignores unknown codeman labels", () => {
  assert.deepEqual(stateOf(["codeman:unknown"]), { ok: true, state: "new" });
});

test("builds state labels", () => {
  assert.equal(stateLabel("in-progress"), "codeman:in-progress");
});
