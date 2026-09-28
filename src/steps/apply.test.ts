import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../i18n/en.ts";
import type { TaskRecord } from "../record.ts";
import { afterAccept, chains } from "./apply.ts";

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
