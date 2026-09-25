import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeStatus, type TaskRecord } from "./record.ts";
import {
  authorizedComments,
  type CommentLike,
  chooseTask,
  commandsAfter,
  commenters,
  findStatus,
  pendingWork,
  replanRequests,
  taskSettings,
  toTask,
} from "./tasks.ts";

const comment = (id: number, body: string, login = "alice", type = "User"): CommentLike => ({
  id,
  body,
  user: { login, type },
  created_at: "2026-09-24",
});

/** Users with write access in these tests. */
const maintainers = new Set(["alice", "bob", "codeman[bot]"]);
const authorized = (comments: CommentLike[]) => authorizedComments(comments, maintainers);

const record: TaskRecord = {
  branch: "codeman/1-x",
  planPath: "plans/x.md",
  summary: "s",
  decisions: [],
  processedCommentId: 0,
};

test("maps an issue", () => {
  const task = toTask({
    number: 7,
    title: "Add rate limiting",
    body: null,
    html_url: "https://github.com/o/r/issues/7",
    labels: [{ name: "codeman" }, "bug", {}],
  });
  assert.deepEqual(task, {
    number: 7,
    kind: "issue",
    title: "Add rate limiting",
    body: "",
    url: "https://github.com/o/r/issues/7",
    labels: ["codeman", "bug"],
  });
});

test("detects pull requests", () => {
  const task = toTask({
    number: 8,
    title: "Fix typo",
    html_url: "https://github.com/o/r/pull/8",
    pull_request: {},
    labels: [],
  });
  assert.equal(task.kind, "pull_request");
});

test("keeps only comments from users with write access", () => {
  const comments = authorized([
    comment(1, "a", "alice"),
    comment(2, "b", "bob"),
    comment(3, "c", "mallory"),
    comment(4, "d", "codeman[bot]", "Bot"),
    { ...comment(5, "e"), user: null },
  ]);
  assert.deepEqual(
    comments.map((c) => [c.id, c.author]),
    [
      [1, "alice"],
      [2, "bob"],
    ],
  );
});

test("lists human commenters once, to look up their permission", () => {
  assert.deepEqual(
    commenters([
      comment(1, "a", "alice"),
      comment(2, "b", "mallory"),
      comment(3, "c", "alice"),
      comment(4, "d", "codeman[bot]", "Bot"),
    ]),
    ["alice", "mallory"],
  );
});

test("unauthorized commands never reach the task", () => {
  const comments = authorized([
    comment(1, "/codeman approve", "mallory"),
    comment(2, "/codeman model evil/model", "eve"),
    comment(3, "/codeman decide 1=b", "codeman[bot]", "Bot"),
  ]);
  assert.deepEqual(commandsAfter(comments, 0), []);
  assert.deepEqual(taskSettings(comments), {});
});

test("lists commands after a comment, in order", () => {
  const comments = authorized([
    comment(3, "/codeman decide 1=b"),
    comment(1, "/codeman approve"),
    comment(2, "just a note"),
  ]);
  const sources = commandsAfter(comments, 1);
  assert.deepEqual(
    sources.map((s) => [s.commentId, s.command.kind]),
    [[3, "decide"]],
  );
});

test("the last valid setting command wins", () => {
  const comments = authorized([
    comment(1, "/codeman model a/one\n/codeman set task-budget 5"),
    comment(2, "/codeman set model b/two"),
    comment(3, "/codeman model not-a-model\n/codeman set max-runs 0"),
  ]);
  assert.deepEqual(taskSettings(comments), { model: "b/two", "task-budget": 5 });
});

test("records answers before planning, oldest task first", () => {
  assert.deepEqual(
    chooseTask([
      { number: 1, state: "new" },
      { number: 3, state: "awaiting-decision", pending: "record" },
      { number: 2, state: "ready", pending: "record" },
    ]),
    { number: 2, action: "record" },
  );
  assert.deepEqual(
    chooseTask([
      { number: 5, state: "planning" },
      { number: 4, state: "awaiting-decision" },
      { number: 9, state: "new" },
    ]),
    { number: 5, action: "plan" },
  );
  assert.equal(
    chooseTask([
      { number: 1, state: "awaiting-decision" },
      { number: 2, state: "blocked" },
      { number: 3, state: "done" },
    ]),
    undefined,
  );
});

test("implements after planning, work in progress first", () => {
  assert.deepEqual(
    chooseTask([
      { number: 1, state: "ready" },
      { number: 4, state: "in-progress" },
      { number: 6, state: "new" },
    ]),
    { number: 6, action: "plan" },
  );
  assert.deepEqual(
    chooseTask([
      { number: 1, state: "ready" },
      { number: 4, state: "in-progress" },
    ]),
    { number: 4, action: "implement" },
  );
  assert.deepEqual(chooseTask([{ number: 1, state: "ready" }]), {
    number: 1,
    action: "implement",
  });
});

test("only the App's own comment counts as the status comment", () => {
  const forged = comment(1, encodeStatus({ ...record, branch: "evil" }), "mallory");
  const real = comment(2, encodeStatus(record), "codeman[bot]", "Bot");
  assert.deepEqual(findStatus([forged, real], "codeman[bot]"), { id: 2, record });
  assert.equal(findStatus([forged], "codeman[bot]"), undefined);
});

test("a task with a replan request goes back to planning", () => {
  assert.deepEqual(
    chooseTask([
      { number: 1, state: "awaiting-decision" },
      { number: 2, state: "ready", pending: "replan" },
      { number: 3, state: "new" },
    ]),
    { number: 2, action: "plan" },
  );
});

test("replan wins over answers in the same batch", () => {
  const comments = authorized([
    comment(1, "/codeman decide 1 a"),
    comment(2, "/codeman replan\nSplit step 2 in two."),
  ]);
  assert.equal(pendingWork(commandsAfter(comments, 0)), "replan");
  assert.equal(pendingWork(commandsAfter(comments, 1)), "replan");
  assert.equal(pendingWork(commandsAfter(comments.slice(0, 1), 0)), "record");
  assert.equal(pendingWork([]), undefined);
  assert.deepEqual(replanRequests(commandsAfter(comments, 0)), ["Split step 2 in two."]);
});
