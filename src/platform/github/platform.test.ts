import assert from "node:assert/strict";
import { test } from "node:test";
import { toCiRun } from "./ci.ts";
import { toComment, toIssue, toReview, toReviewComment } from "./platform.ts";

test("maps an issue", () => {
  assert.deepEqual(
    toIssue({
      number: 7,
      title: "Add rate limiting",
      body: null,
      html_url: "https://github.com/o/r/issues/7",
      labels: [{ name: "codeman" }, "bug", {}],
      user: { login: "alice", type: "User" },
    }),
    {
      number: 7,
      kind: "issue",
      title: "Add rate limiting",
      body: "",
      url: "https://github.com/o/r/issues/7",
      labels: ["codeman", "bug"],
      author: { login: "alice", bot: false },
    },
  );
});

test("a pull request is an issue that is a change request; a deleted account has no author", () => {
  const issue = toIssue({
    number: 8,
    title: "Fix typo",
    html_url: "https://github.com/o/r/pull/8",
    pull_request: {},
    labels: [],
    user: null,
  });
  assert.equal(issue.kind, "change-request");
  assert.equal(issue.author, null);
});

test("maps comments, with bots marked", () => {
  assert.deepEqual(
    toComment({
      id: 3,
      user: { login: "codeman[bot]", type: "Bot" },
      created_at: "2026-09-24",
    }),
    { id: 3, author: { login: "codeman[bot]", bot: true }, body: "", createdAt: "2026-09-24" },
  );
});

test("maps review states to verdicts", () => {
  const review = (state: string) => toReview({ id: 1, state, user: null }).verdict;
  assert.equal(review("CHANGES_REQUESTED"), "changes-requested");
  assert.equal(review("APPROVED"), "approved");
  assert.equal(review("COMMENTED"), "commented");
  assert.equal(review("DISMISSED"), "dismissed");
  assert.equal(review("PENDING"), "pending");
});

test("a line comment keeps its original line when the diff moved", () => {
  assert.deepEqual(
    toReviewComment({
      pull_request_review_id: 5,
      path: "src/b.ts",
      line: null,
      original_line: 9,
      body: "Nit.",
    }),
    { reviewId: 5, path: "src/b.ts", line: 9, body: "Nit." },
  );
});

test("maps workflow runs, named by their path when they have no name", () => {
  const run = {
    id: 1,
    name: null,
    path: ".github/workflows/ios.yml",
    status: "completed",
    conclusion: "success",
    html_url: "https://x/1",
  };
  assert.deepEqual(toCiRun(run), {
    id: 1,
    name: ".github/workflows/ios.yml",
    path: ".github/workflows/ios.yml",
    finished: true,
    conclusion: "success",
    url: "https://x/1",
  });
  assert.equal(toCiRun({ ...run, status: "in_progress" }).finished, false);
});
