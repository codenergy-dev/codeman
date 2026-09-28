import assert from "node:assert/strict";
import { test } from "node:test";
import { isStage, nextStage, STAGE_STATE, STAGES, stageOfState } from "./stages.ts";
import { chooseTask } from "./tasks.ts";

test("stages run in order, each with its own state", () => {
  assert.deepEqual(STAGES, ["design", "code", "test", "review"]);
  assert.equal(nextStage("design"), "code");
  assert.equal(nextStage("review"), undefined);
  for (const stage of STAGES) assert.equal(stageOfState(STAGE_STATE[stage]), stage);
  assert.equal(stageOfState("in-progress"), "code", "tasks from before stages go on coding");
  assert.equal(stageOfState("ready"), undefined);
  assert.ok(isStage("test") && !isStage("plan"));
});

test("a task in any stage goes on", () => {
  for (const state of ["designing", "coding", "testing", "reviewing"] as const) {
    assert.deepEqual(chooseTask([{ number: 1, state }]), { number: 1, action: "implement" });
  }
});
