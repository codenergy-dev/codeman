import assert from "node:assert/strict";
import { test } from "node:test";
import { pullRequestBody, pullRequestTitle } from "./pull.ts";

const view = {
  issue: 12,
  planPath: "plans/x.md",
  planUrl: "https://github.com/o/r/blob/codeman/12-x/plans/x.md",
  planSummary: "Adds rate limiting.",
  summary: "- Added a limiter\n- Pinged @everyone ![x](http://tracker)",
  commitMessage: "Add rate limiting\n\nUses ```fences``` in the body.",
  runUrl: "https://github.com/o/r/actions/runs/1",
};

test("links the issue and renders the agent's text inert", () => {
  const body = pullRequestBody(view);
  assert.ok(body.startsWith("Closes #12\n"));
  assert.match(body, /^- Added a limiter$/m);
  assert.ok(!body.includes("@everyone"));
  assert.ok(!body.includes("![x]"));
});

test("fences the squash message with more backticks than it contains", () => {
  const body = pullRequestBody(view);
  assert.match(body, /\n````text\nAdd rate limiting\n\nUses ```fences``` in the body\.\n````\n/);
});

test("titles the pull request with the commit subject", () => {
  assert.equal(pullRequestTitle(view.commitMessage), "Add rate limiting");
  assert.equal(pullRequestTitle(""), "Codeman task");
});
