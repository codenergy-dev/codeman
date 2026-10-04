import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../i18n/en.ts";
import type { TaskRecord } from "../record.ts";
import { afterAccept, afterReview, chains, defer, goesOn } from "./apply.ts";

test("starts another run only when this one moved a task", () => {
  assert.equal(chains("record", "skipped", ""), true);
  assert.equal(chains("accept", "skipped", ""), true);
  assert.equal(chains("plan", "success", "opened"), true);
  assert.equal(chains("implement", "success", "opened"), true);
  assert.equal(chains("implement", "success", "over-budget"), false, "the budget is reached");
  assert.equal(chains("plan", "failure", ""), false, "no key was created");
});

test("accepting workflows resumes a blocked stage", () => {
  const record: TaskRecord = {
    branch: "b",
    planPath: "p.md",
    summary: "",
    decisions: [],
    processedCommentId: 0,
    stage: "test",
    runs: 2,
  };
  const workflows = [".github/workflows/deploy.yml"];
  const accepted = { by: "alice", workflows };

  const blocked = afterAccept(en, "blocked", record, "alice", workflows);
  assert.equal(blocked.state, "testing");
  assert.equal(blocked.record.runs, 0, "a fresh run count");
  assert.deepEqual(blocked.record.accepted, accepted);
  assert.match(blocked.message, /test stage goes on/);

  const waiting = afterAccept(en, "awaiting-workflow", record, "alice", workflows);
  assert.equal(waiting.state, "awaiting-workflow", "waits for the runs");
  assert.equal(waiting.record.runs, 2);
  assert.deepEqual(waiting.record.accepted, accepted);

  const planning = afterAccept(en, "blocked", { ...record, stage: undefined }, "alice", workflows);
  assert.equal(planning.state, "blocked", "no stage to resume");
  assert.equal(planning.message, "");
});

const base: TaskRecord = {
  branch: "b",
  planPath: "p.md",
  summary: "",
  decisions: [],
  processedCommentId: 0,
};
const ios = ".github/workflows/ios.yml";

test("a stage that needs staged workflows defers its wait, and the task goes on", () => {
  const staged = new Set([ios]);
  assert.deepEqual(defer(base, "code", [ios], staged)?.deferred, {
    stage: "code",
    workflows: [ios],
  });
  assert.deepEqual(defer(base, "test", [ios, ".github/workflows/ci.yml"], staged)?.deferred, {
    stage: "test",
    workflows: [ios, ".github/workflows/ci.yml"],
  });
  assert.equal(defer(base, "test", [ios], new Set()), undefined, "accepted ones are waited for");
});

test("after review, staged workflows wait for the accept; deferred runs, for their runs", () => {
  const deferred = {
    ...base,
    stage: "review" as const,
    deferred: { stage: "code" as const, workflows: [ios] },
  };

  const waiting = afterReview(en, deferred, [ios]);
  assert.equal(waiting.state, "awaiting-workflow");
  assert.equal(waiting.record.reviewed, true);
  assert.deepEqual(waiting.record.deferred, deferred.deferred, "kept for the accept");
  assert.match(
    waiting.message,
    /Review passed\. The task waits for the staged workflows to be accepted: \.github\/workflows\/ios\.yml/,
  );

  const accepted = afterReview(en, deferred, []);
  assert.equal(accepted.state, "awaiting-workflow", "accepted meanwhile: wait for their runs");
  assert.equal(accepted.record.stage, "code");
  assert.deepEqual(accepted.record.awaiting, [ios]);
  assert.equal(accepted.record.deferred, undefined);

  const done = afterReview(en, { ...base, stage: "review" }, []);
  assert.equal(done.state, "done");
  assert.equal(done.record.stage, undefined);
});

test("accepting after review finishes the task, or waits for the deferred runs", () => {
  const reviewed = { ...base, reviewed: true };
  const done = afterAccept(en, "awaiting-workflow", reviewed, "alice", [ios]);
  assert.equal(done.state, "done");
  assert.equal(done.record.reviewed, undefined);

  const deferred = { ...reviewed, deferred: { stage: "test" as const, workflows: [ios] } };
  const runs = afterAccept(en, "awaiting-workflow", deferred, "alice", [ios]);
  assert.equal(runs.state, "awaiting-workflow");
  assert.equal(runs.record.stage, "test");
  assert.deepEqual(runs.record.awaiting, [ios]);
  assert.equal(runs.record.deferred, undefined);
  assert.equal(runs.record.reviewed, undefined);
  assert.deepEqual(runs.record.accepted, { by: "alice", workflows: [ios] });
});

test("a task goes on to another agent run while it is ready, routing or in a stage", () => {
  for (const state of [
    "ready",
    "routing",
    "designing",
    "coding",
    "reviewing",
    "in-progress",
  ] as const) {
    assert.equal(goesOn(state), true, state);
  }
  for (const state of [
    "new",
    "awaiting-decision",
    "awaiting-workflow",
    "blocked",
    "done",
  ] as const) {
    assert.equal(goesOn(state), false, state);
  }
});
