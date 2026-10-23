import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runnerProblem, selectScenarios } from "./filter.ts";
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
  assert.deepEqual(ids(["pods/keep"]), ["pods/keep"]);
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

test("a scenario under act may not fault a job or apply: act runs success paths only", () => {
  const { root } = suite();
  const write = (name: string, runner: string, action: string) => {
    writeFileSync(
      join(root, `${name}.yaml`),
      `name: ${name}
runner: ${runner}
world:
  repositories: [{ name: acme/app, fixture: node-small, maintainers: [alice] }]
actions:
  - open-issue: { ref: i1, as: alice, title: A task, labels: [codeman] }
  - ${action}
`,
    );
  };
  write("smoke", "act", "run: { event: issues.labeled }");
  write("job-fault", "act", "fault: { job: { name: apply } }");
  write("nested", "act", "parallel: [[{ apply: { mode: skip } }], [{ wait: { for: 1s } }]]");
  write("simulated", "simulator", "fault: { job: { name: apply } }");
  const scenarios = loadScenarios(root);
  const pick = (id: string) => scenarios.filter((scenario) => scenario.id === id);
  assert.equal(runnerProblem([...pick("smoke"), ...pick("simulated")]), undefined);
  const problem = runnerProblem(scenarios);
  assert.match(problem ?? "", /act runs success paths only/);
  assert.match(problem ?? "", /job-fault, nested\./);
  assert.doesNotMatch(problem ?? "", /smoke|simulated/);
});

test("a file with two runners makes two scenarios: the act one has .act and the tag act", () => {
  const { root } = suite();
  writeFileSync(
    join(root, "both.yaml"),
    `name: both
tags: [smoke]
runner: [simulator, act]
world:
  repositories: [{ name: acme/app, fixture: node-small, maintainers: [alice] }]
actions:
  - run: { event: schedule }
`,
  );
  const scenarios = loadScenarios(root);
  const both = scenarios.filter((scenario) => scenario.file.endsWith("both.yaml"));
  assert.deepEqual(
    both.map((scenario) => [scenario.id, scenario.runner, scenario.tags]),
    [
      ["both", "simulator", ["smoke"]],
      ["both.act", "act", ["smoke", "act"]],
    ],
  );
  const ids = (args: string[]) =>
    selectScenarios(scenarios, args, { cwd: root, root }).map((scenario) => scenario.id);
  assert.deepEqual(ids(["both.yaml"]), ["both", "both.act"]);
  assert.deepEqual(ids(["both"]), ["both"]);
  assert.deepEqual(ids(["both.act"]), ["both.act"]);
  assert.deepEqual(ids(["act"]), ["both.act"]);
});
