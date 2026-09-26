import assert from "node:assert/strict";
import { test } from "node:test";
import { chains } from "./apply.ts";

test("starts another run only when this one moved a task", () => {
  assert.equal(chains("record", "skipped", ""), true);
  assert.equal(chains("plan", "success", "opened"), true);
  assert.equal(chains("implement", "success", "opened"), true);
  assert.equal(chains("implement", "success", "over-budget"), false, "the budget is reached");
  assert.equal(chains("plan", "failure", ""), false, "no key was created");
});
