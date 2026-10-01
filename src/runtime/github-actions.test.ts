import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubActionsRuntime } from "./github-actions.ts";

test("a run's ID comes from the end of its link", () => {
  const runtime = new GitHubActionsRuntime();
  assert.equal(runtime.runIdOf("https://github.com/o/r/actions/runs/123"), "123");
  assert.equal(runtime.runIdOf("https://github.com/o/r/actions/runs/123/attempts/2"), undefined);
});

test("links this run, in the workflow's repository", () => {
  const env = { ...process.env };
  try {
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "o/r";
    process.env.GITHUB_RUN_ID = "42";
    const runtime = new GitHubActionsRuntime();
    assert.deepEqual(runtime.run, { id: "42", url: "https://github.com/o/r/actions/runs/42" });
    assert.equal(runtime.runIdOf(runtime.run.url), "42");
    assert.deepEqual(runtime.repository, { owner: "o", name: "r" });
  } finally {
    process.env = env;
  }
});
