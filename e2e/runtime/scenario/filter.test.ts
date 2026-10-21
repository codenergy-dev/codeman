import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { selectScenarios } from "./filter.ts";
import { loadScenarios } from "./load.ts";

/** Three scenarios under a scratch root: two in `pods/`, one in `budgets/`. */
function suite() {
  const root = mkdtempSync(join(tmpdir(), "codeman-e2e-scenarios-"));
  const write = (path: string, tags: string[]) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(
      join(root, path),
      `name: ${path}
tags: [${tags.join(", ")}]
world:
  repositories: [{ name: acme/app, fixture: node-small, maintainers: [alice] }]
actions:
  - run: { event: schedule }
`,
    );
  };
  write("pods/keep.yaml", ["ollama"]);
  write("pods/vllm-seats.yaml", ["vllm"]);
  write("budgets/monthly.yaml", ["ollama", "budget"]);
  return { root, scenarios: loadScenarios(root) };
}

test("scenarios are chosen by path or by tag, in the suite's order", () => {
  const { root, scenarios } = suite();
  const ids = (args: string[], cwd = root) =>
    selectScenarios(scenarios, args, { cwd, root }).map((scenario) => scenario.id);
  assert.deepEqual(ids([]), ["budgets/monthly", "pods/keep", "pods/vllm-seats"]);
  assert.deepEqual(ids(["pods"]), ["pods/keep", "pods/vllm-seats"]);
  assert.deepEqual(ids(["ollama"]), ["budgets/monthly", "pods/keep"]);
  assert.deepEqual(ids(["vllm", "budgets"]), ["budgets/monthly", "pods/vllm-seats"]);
  assert.deepEqual(ids(["pods/keep.yaml"]), ["pods/keep"]);
  assert.deepEqual(ids([join(root, "budgets")], tmpdir()), ["budgets/monthly"]);
  assert.deepEqual(ids(["./pods/keep.yaml"], join(root, "..")), ["pods/keep"]);
});

test("an argument that matches no scenario is an error", () => {
  const { root, scenarios } = suite();
  assert.throws(
    () => selectScenarios(scenarios, ["pods", "olama"], { cwd: root, root }),
    /No scenario has the tag or is under olama\./,
  );
  assert.throws(
    () => selectScenarios(scenarios, ["pods/missing.yaml"], { cwd: root, root }),
    /pods\/missing\.yaml/,
  );
});
