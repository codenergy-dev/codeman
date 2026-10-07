import assert from "node:assert/strict";
import { test } from "node:test";
import { addPod, MAX_PODS } from "./spend.ts";

test("the record lists the task's pods and their runs, and marks a shared one", () => {
  const older = [{ id: "a", runs: ["90"], counted: 0.3 }];
  let pods = addPod(older, { runId: "100", pod: "a" });
  pods = addPod(pods, { runId: "100", pod: "a" });
  pods = addPod(pods, { runId: "101", pod: "b", shared: true });
  assert.deepEqual(pods, [
    { id: "a", runs: ["90", "100"], counted: 0.3 },
    { id: "b", runs: ["101"], shared: true },
  ]);
  assert.deepEqual(older, [{ id: "a", runs: ["90"], counted: 0.3 }], "the record's own is kept");
});

test("keeps the newest pods only", () => {
  let pods = addPod(undefined, { runId: "0", pod: "p0" });
  for (let index = 1; index <= MAX_PODS; index++) {
    pods = addPod(pods, { runId: String(index), pod: `p${index}` });
  }
  assert.equal(pods.length, MAX_PODS);
  assert.equal(pods[0]?.id, "p1");
});
