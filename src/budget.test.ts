import assert from "node:assert/strict";
import { test } from "node:test";
import { runLimit, usd } from "./budget.ts";

test("a run gets what remains of the task budget, in cents rounded down", () => {
  assert.equal(runLimit(2, 0), 2);
  assert.equal(runLimit(2, 0.2), 1.8);
  assert.equal(runLimit(2, 0.2345), 1.76);
  assert.equal(runLimit(2, 1.9), 0.1);
  assert.equal(runLimit(2, 1.95), undefined, "below the floor");
  assert.equal(runLimit(2, 2.3), undefined, "overspent");
  assert.equal(usd(1.8), "US$ 1.80");
});
