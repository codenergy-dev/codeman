import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { withAgentMinutes } from "./world.ts";

test("a repository's agent-minutes replaces the one line of the task workflow's template", () => {
  const template = readFileSync("templates/codeman-task.yml", "utf8");
  const changed = withAgentMinutes(template, 1);
  assert.match(changed, /^ {10}agent-minutes: 1$/m);
  assert.doesNotMatch(changed, /agent-minutes: 50/);
  assert.equal(changed.split("\n").length, template.split("\n").length);
  assert.throws(() => withAgentMinutes("jobs: {}\n", 1), /no agent-minutes line/);
});
