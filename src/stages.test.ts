import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isStage,
  nextInRoute,
  nextStage,
  STAGE_STATE,
  STAGES,
  stageOfState,
  stagesFrom,
} from "./stages.ts";
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

test("a route's next stage is its first later stage, and without a route the fixed order", () => {
  const route = { stages: [{ stage: "code" as const }, { stage: "review" as const }] };
  assert.equal(nextInRoute(route, "code"), "review");
  assert.equal(nextInRoute(route, "design"), "code", "a stage outside the route goes on to it");
  assert.equal(nextInRoute(route, "review"), undefined);
  assert.equal(nextInRoute(undefined, "test"), "review");
  assert.deepEqual(stagesFrom("code"), ["code", "test", "review"]);
});

test("a task left routing goes on routing", () => {
  assert.deepEqual(chooseTask([{ number: 1, state: "routing" }]), {
    number: 1,
    action: "implement",
  });
});
