// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the tests hold workflow expressions, not JavaScript templates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AVAILABILITY,
  type Contexts,
  EvaluationError,
  ExpressionError,
  evaluate,
  evaluateCondition,
  evaluateValue,
  interpolate,
  looseEquals,
  type Scope,
  type Status,
  truthy,
} from "./expressions.ts";
import { loadWorkflow, scopeOf, workflowExpressions } from "./workflow.ts";

const ALL: Scope = { file: "test.yml", key: "test", contexts: AVAILABILITY.step };
const IF: Scope = {
  file: "test.yml",
  key: "jobs.a.if",
  contexts: AVAILABILITY["job.if"],
  status: true,
};
const status = (overrides: Partial<Status> = {}): Status => ({
  success: () => true,
  failure: () => false,
  cancelled: () => false,
  ...overrides,
});
const run = (expression: string, contexts: Contexts = {}) => evaluate(expression, contexts, ALL);

test("literals, and GitHub's loose equality and truthiness", () => {
  assert.equal(run("'it''s'"), "it's");
  assert.equal(run("0x1A"), 26);
  assert.equal(run("-2.5e1"), -25);
  assert.equal(run("null"), null);
  // Mismatched types compare as numbers; strings ignore case.
  const pairs: [unknown, unknown, boolean][] = [
    ["ABC", "abc", true],
    ["", 0, true],
    [null, 0, true],
    [null, "", true],
    [true, 1, true],
    [true, "1", true],
    ["true", true, false],
    ["0x10", 16, true],
    ["a", 0, false],
    [Number.NaN, Number.NaN, false],
    [[], [], false],
    [{}, 0, false],
  ];
  for (const [left, right, equal] of pairs) {
    assert.equal(
      looseEquals(left, right),
      equal,
      `${JSON.stringify(left)} == ${JSON.stringify(right)}`,
    );
  }
  for (const value of [false, 0, "", null, Number.NaN]) assert.equal(truthy(value), false);
  for (const value of [true, 1, "0", "false", [], {}]) assert.equal(truthy(value), true);
  assert.equal(run("1 == 1 && 'x' || 'y'"), "x");
  assert.equal(run("0 == 1 && 'x' || 'y'"), "y");
  assert.equal(run("!'' && !0"), true);
  assert.equal(run("!(1 == 1)"), false);
  assert.equal(run("'' || null"), null);
});

test("contexts, properties with hyphens and any case, indexes and the .* filter", () => {
  const contexts: Contexts = {
    needs: { "open-key": { outputs: { "key-hash": "h" }, result: "success" } },
    github: {
      event: {
        issue: { labels: [{ name: "codeman" }, { name: "bug" }, { color: "red" }] },
        comment: { user: { type: "User" } },
      },
    },
    inputs: { "task-budget": "2" },
  };
  assert.equal(run("needs.open-key.outputs.key-hash", contexts), "h");
  assert.equal(run("NEEDS.Open-Key.Result", contexts), "success");
  assert.equal(run("needs['open-key'].outputs['key-hash']", contexts), "h");
  assert.equal(run("needs.absent.outputs.x", contexts), null);
  assert.equal(run("github.event.issue.labels[1].name", contexts), "bug");
  assert.deepEqual(run("github.event.issue.labels.*.name", contexts), ["codeman", "bug"]);
  assert.equal(run("contains(github.event.issue.labels.*.name, 'CODEMAN')", contexts), true);
  assert.equal(run("contains(github.event.issue.labels.*.name, 'cod')", contexts), false);
  assert.equal(run("inputs.task-budget == 2", contexts), true);
  assert.equal(run("matrix.task"), null);
});

test("the functions", () => {
  assert.equal(run("contains('Hello /CODEMAN decide', '/codeman')"), true);
  assert.equal(run("startsWith('codeman/12-x', 'CODEMAN/')"), true);
  assert.equal(run("endsWith('a.yml', '.YML')"), true);
  assert.equal(run("format('codeman-skipped-{0}', 42)"), "codeman-skipped-42");
  assert.equal(run("format('{{x}} {1}{0}', 'a', 'b')"), "{x} ba");
  assert.deepEqual(run('fromJSON(\'[{"task":"1"}]\')'), [{ task: "1" }]);
  assert.equal(run("fromJSON('true')"), true);
  assert.equal(run("toJSON(fromJSON('{\"a\":1}'))"), '{\n  "a": 1\n}');
  assert.equal(run("join(fromJSON('[1,2]'), '-')"), "1-2");
  assert.equal(run("join(fromJSON('[1,2]'))"), "1,2");
  assert.throws(() => run("fromJSON('')"), EvaluationError);
  assert.throws(() => run("format('{1}', 'a')"), EvaluationError);
});

test("an if adds success() unless it calls a status function", () => {
  const contexts: Contexts = { needs: { a: { result: "skipped", outputs: { x: "1" } } } };
  const failed = status({ success: () => false, failure: () => true });
  assert.equal(evaluateCondition("needs.a.outputs.x == '1'", contexts, IF, status()), true);
  assert.equal(evaluateCondition("needs.a.outputs.x == '1'", contexts, IF, failed), false);
  assert.equal(
    evaluateCondition("always() && needs.a.outputs.x == '1'", contexts, IF, failed),
    true,
  );
  assert.equal(evaluateCondition("${{ failure() }}", contexts, IF, failed), true);
  assert.equal(evaluateCondition("${{ !cancelled() }}", contexts, IF, failed), true);
  assert.equal(evaluateCondition(true, contexts, IF, failed), false);
});

test("text with expressions, and a value that is one expression alone", () => {
  const contexts: Contexts = {
    matrix: { owner: "acme", repository: "app" },
    needs: { s: { outputs: { list: "[1]" } } },
  };
  assert.equal(
    interpolate("Wake ${{ matrix.owner }}/${{ matrix.repository }}", contexts, ALL),
    "Wake acme/app",
  );
  assert.deepEqual(evaluateValue("${{ fromJSON(needs.s.outputs.list) }}", contexts, ALL), [1]);
  assert.equal(evaluateValue("x ${{ fromJSON(needs.s.outputs.list) }}", contexts, ALL), "x Array");
  assert.equal(interpolate("${{ '}}' }}", {}, ALL), "}}");
  assert.equal(interpolate(null, {}, ALL), "");
});

test("anything outside the subset throws, naming the expression, the file and the key", () => {
  const unsupported = [
    "hashFiles('**/x')",
    "a.b < 2",
    "1 >= 2",
    "env.A",
    "secrets.X",
    "always()",
    "toJSON()",
    "x == ",
    "'open",
    "a ~ b",
  ];
  const scope: Scope = {
    file: "templates/codeman.yml",
    key: "concurrency.group",
    contexts: AVAILABILITY.concurrency,
  };
  for (const expression of unsupported) {
    assert.throws(
      () => evaluate(expression, {}, scope),
      (error: Error) =>
        error instanceof ExpressionError &&
        error.message.startsWith("templates/codeman.yml: concurrency.group: ${{") &&
        error.message.includes(expression.trim()),
      expression,
    );
  }
  assert.throws(() => interpolate("${{ github.x", {}, scope), ExpressionError);
  assert.throws(
    () => evaluateCondition("x ${{ always() }}", {}, IF, status()),
    /mixes text and an expression/,
  );
});

/** A context for every key of the templates, with values like a run's. */
const SAMPLE: Contexts = {
  github: {
    event_name: "issue_comment",
    event: {
      action: "created",
      comment: { body: "/codeman decide 1a", user: { type: "User" } },
      issue: { labels: [{ name: "codeman" }] },
      label: { name: "codeman" },
      review: { user: { type: "User" }, state: "changes_requested", body: "" },
      pull_request: { head: { ref: "codeman/1", repo: { full_name: "acme/app" } } },
      repository: { default_branch: "main" },
    },
    repository: "acme/app",
    run_id: "9001",
    workflow: "Codeman",
    ref_name: "main",
    token: "ghs_job",
  },
  inputs: {
    model: "",
    "task-budget": "",
    "monthly-budget": "",
    "max-runs": "",
    batch: "",
    task: "1",
    action: "record",
    "needs-agent": "false",
    stage: "",
    "base-sha": "abc",
    "organization-monthly-budget": "",
    inference: "{}",
    "ledger-run": "",
  },
  needs: {
    select: {
      result: "success",
      outputs: { action: "record", tasks: '[{"task":"1"}]', dispatches: "[]" },
    },
    "open-key": { result: "skipped", outputs: {} },
    agent: { result: "skipped", outputs: {} },
    "close-key": { result: "skipped", outputs: {} },
    apply: { result: "success", outputs: { chain: "true", continues: "false" } },
    task: { result: "success", outputs: {} },
  },
  matrix: { task: "1", owner: "acme", repository: "site", batches: "b1" },
  strategy: { "fail-fast": false, "job-index": 0, "job-total": 1, "max-parallel": 1 },
  steps: {
    codeman: { outputs: { action: "record", chain: "true" } },
    "app-token": { outputs: { token: "ghs_app" } },
  },
  secrets: { CODEMAN_GITHUB_APP_PRIVATE_KEY: "key" },
  vars: { CODEMAN_COMMIT_SHA: "0".repeat(40) },
  env: {},
  runner: { temp: "/home/runner/work/_temp" },
  job: { status: "success" },
  jobs: {},
};

/** Expressions the simulator cannot evaluate from a sample, with why; none today. */
const KNOWN = new Map<string, string>();

test("every expression of the templates is in the subset and evaluates where it is", () => {
  const seen = new Set<string>();
  let count = 0;
  for (const name of ["codeman.yml", "codeman-task.yml"]) {
    const file = `templates/${name}`;
    const source = readFileSync(file, "utf8");
    loadWorkflow(source, file);
    for (const located of workflowExpressions(source, file)) {
      count++;
      seen.add(located.expression);
      if (KNOWN.has(located.expression)) continue;
      const scope = scopeOf(file, located);
      const contexts = Object.fromEntries(
        Object.entries(SAMPLE).filter(([name]) =>
          (scope.contexts as readonly string[]).includes(name),
        ),
      );
      if (located.condition) {
        assert.equal(
          typeof evaluateCondition(located.expression, contexts, scope, status()),
          "boolean",
          `${file}: ${located.key}`,
        );
      } else {
        evaluate(located.expression, contexts, scope);
      }
    }
  }
  assert.ok(count > 150, `only ${count} expressions found`);
  for (const expression of KNOWN.keys()) assert.ok(seen.has(expression), `stale: ${expression}`);
});

test("the concurrency group is codeman exactly when select runs", () => {
  const file = "templates/codeman.yml";
  const source = readFileSync(file, "utf8");
  const [group] = workflowExpressions(source, file).filter(
    (located) => located.key === "concurrency.group",
  );
  assert.ok(group);
  const scope = scopeOf(file, group);
  const at = (event: Record<string, unknown>, name: string) =>
    evaluate(group.expression, { github: { event_name: name, event, run_id: "7" } }, scope);
  assert.equal(
    at({ comment: { body: "/codeman go", user: { type: "User" } } }, "issue_comment"),
    "codeman",
  );
  assert.equal(
    at({ comment: { body: "/codeman go", user: { type: "Bot" } } }, "issue_comment"),
    "codeman-skipped-7",
  );
  assert.equal(
    at({ action: "labeled", label: { name: "codeman:planning" } }, "issues"),
    "codeman-skipped-7",
  );
  assert.equal(
    at({ action: "closed", issue: { labels: [{ name: "codeman" }] } }, "issues"),
    "codeman",
  );
  assert.equal(at({}, "schedule"), "codeman");
});
