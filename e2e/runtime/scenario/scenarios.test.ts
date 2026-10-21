import assert from "node:assert/strict";
import { test } from "node:test";
import { loadScenario, SCENARIOS_ROOT, scenarioFiles } from "./load.ts";

// Every scenario of the suite parses, so `npm test` checks a new one before the e2e run does.
const files = scenarioFiles(SCENARIOS_ROOT);

test("the suite has scenarios", () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`${file.slice(SCENARIOS_ROOT.length)} parses`, () => {
    const scenario = loadScenario(file);
    assert.ok(scenario.actions.length > 0);
  });
}

test("scenario IDs are unique", () => {
  const ids = files.map((file) => loadScenario(file).id);
  assert.equal(new Set(ids).size, ids.length);
});
