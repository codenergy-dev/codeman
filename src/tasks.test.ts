import assert from "node:assert/strict";
import { test } from "node:test";
import { oneLine, toTask } from "./tasks.ts";

test("maps an issue", () => {
  const task = toTask({
    number: 7,
    title: "Add rate limiting",
    html_url: "https://github.com/o/r/issues/7",
    labels: [{ name: "codeman" }, "bug", {}],
  });
  assert.deepEqual(task, {
    number: 7,
    kind: "issue",
    title: "Add rate limiting",
    url: "https://github.com/o/r/issues/7",
    labels: ["codeman", "bug"],
  });
});

test("detects pull requests", () => {
  const task = toTask({
    number: 8,
    title: "Fix typo",
    html_url: "https://github.com/o/r/pull/8",
    pull_request: { url: "https://api.github.com/repos/o/r/pulls/8" },
    labels: [],
  });
  assert.equal(task.kind, "pull_request");
});

test("keeps untrusted text on one line", () => {
  assert.equal(oneLine("title\n::add-mask::x\r\nend"), "title ::add-mask::x end");
});
