import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScenario, ScenarioError } from "./load.ts";
import { ACTION_KINDS, type Action, RelativeTime } from "./schema.ts";

const FILE = "e2e/scenarios/test/case.yaml";

const WORLD = `name: A case
world:
  organizations:
    - { name: acme, owners: [olivia], settings: { task-budget: 2 } }
  repositories:
    - { name: acme/app, fixture: node-small, maintainers: [alice], collaborators: { bob: triage } }
`;

function parse(text: string) {
  return parseScenario(text, FILE);
}

/** Expects a ScenarioError naming the field, and the line when given. */
function rejects(text: string, field: string, message: RegExp, line?: number) {
  assert.throws(
    () => parse(text),
    (error: unknown) => {
      assert.ok(error instanceof ScenarioError, String(error));
      assert.equal(error.field, field, error.message);
      assert.match(error.message, message);
      if (line !== undefined) assert.equal(error.line, line, error.message);
      assert.ok(error.message.startsWith(`${FILE}:`), error.message);
      return true;
    },
  );
}

test("a scenario names its world, defaults and actions", () => {
  const scenario = parse(`${WORLD}actions:
  - open-issue: { ref: i1, as: alice, title: Add a route, labels: [codeman] }
  - run: { event: issues.labeled }
`);
  assert.equal(scenario.id, "test/case");
  assert.equal(scenario.runner, "simulator");
  assert.deepEqual(scenario.profiles, []);
  assert.equal(scenario.timeoutMs, 15 * 60 * 1000);
  assert.deepEqual(scenario.world.users.sort(), ["alice", "bob", "olivia"]);
  assert.equal(scenario.world.organizations[0]?.settings, "task-budget: 2\n");
  assert.match(scenario.world.repositories[0]?.fixture ?? "", /e2e\/fixtures\/node-small$/);
  assert.deepEqual(scenario.actions[1], {
    kind: "run",
    repo: "acme/app",
    event: "issues.labeled",
    inputs: {},
    maxRuns: 10,
  });
});

test("an invalid scenario fails with the field's path and its line", () => {
  const text = `${WORLD}actions:
  - open-issue: { ref: i1, as: alice, title: Add a route }
  - run: { event: issues.labeled }
  - expect: { issue: i1, labels: codeman:done }
`;
  rejects(
    text,
    "actions[2].expect.labels",
    /: actions\[2\]\.expect\.labels: expected a list\.$/,
    10,
  );
  rejects(
    `${WORLD}actions:\n  - open-issue: { ref: i1, as: alice }\n`,
    "actions[0].open-issue.title",
    /missing/,
    8,
  );
  rejects(
    `${WORLD}actions:\n  - expect: { issue: i1, labels: [codeman] }\n`,
    "actions[0].expect.issue",
    /the issue ref i1 is not defined/,
  );
  rejects(
    `${WORLD}actions:\n  - open-issue: { ref: i1, as: alice, title: T }\n  - expect: { issue: i1, lables: [codeman] }\n`,
    "actions[1].expect.lables",
    /unknown field; expected one of issue, labels/,
    9,
  );
  rejects(
    `${WORLD}actions:\n  - deploy: {}\n`,
    "actions[0].deploy",
    /unknown; expected one of open-issue/,
  );
  rejects(`${WORLD}actions: []\n`, "actions", /at least one action/);
  rejects(
    `${WORLD}actions:\n  - open-issue: { ref: i1, as: mallory, title: T }\n`,
    "actions[0].open-issue.as",
    /mallory is no user of the world/,
  );
  rejects(
    `${WORLD}actions:\n  - open-issue: { ref: i1, as: alice, title: T }\n  - expect: { issue: i1, labels: [codeman:awaiting-decisions] }\n`,
    "actions[1].expect.labels[0]",
    /no Codeman label: codeman:planning, codeman:awaiting-decision/,
  );
  rejects(
    `${WORLD.replace("node-small", "missing-fixture")}actions:\n  - run: { event: schedule }\n`,
    "world.repositories[0].fixture",
    /no fixture missing-fixture/,
  );
  rejects(
    `${WORLD}actions:\n  - wait: { until: { violations: none }, timeout: 90 }\n`,
    "actions[0].wait.timeout",
    /expected a duration/,
  );
});

test("an undefined ref fails, and a ref is defined once", () => {
  rejects(
    `${WORLD}actions:\n  - comment: { issue: i2, as: alice, body: hi }\n`,
    "actions[0].comment.issue",
    /the issue ref i2 is not defined before this action/,
    8,
  );
  rejects(
    `${WORLD}actions:\n  - open-issue: { ref: i1, as: alice, title: T }\n  - open-issue: { ref: i1, as: alice, title: U }\n`,
    "actions[1].open-issue.ref",
    /already defined/,
  );
  rejects(
    `${WORLD}actions:\n  - fault: { pod: { pod: p1, action: exit } }\n`,
    "actions[0].fault.pod.pod",
    /the pod ref p1 is not defined/,
  );
  // A parallel branch does not see the refs another branch defines.
  rejects(
    `${WORLD}actions:
  - parallel:
      - [{ open-issue: { ref: i1, as: alice, title: T } }]
      - [{ comment: { issue: i1, as: alice, body: hi } }]
`,
    "actions[0].parallel[1][0].comment.issue",
    /i1 is not defined/,
  );
  // The agent's script may name only issues that an action opens.
  rejects(
    `${WORLD}agent:\n  i9: { plan: [] }\nactions:\n  - run: { event: schedule }\n`,
    "agent.i9",
    /no open-issue defines the issue ref i9/,
    8,
  );
});

test("the agent section is checked by the scripted model's own validator", () => {
  rejects(
    `${WORLD}agent:
  i1:
    code:
      - steps:
          - write: { content: x }
actions:
  - open-issue: { ref: i1, as: alice, title: T }
`,
    "agent.i1.code[0].steps[0].write.path",
    /expected a string/,
    11,
  );
  const scenario = parse(`${WORLD}agent:
  i1:
    plan: [{ steps: [{ output: { summary: S, decisions: [] } }] }]
actions:
  - open-issue: { ref: i1, as: alice, title: T }
`);
  assert.equal(scenario.agent.script.i1?.plan?.[0]?.steps[0]?.action.kind, "output");
  assert.deepEqual(scenario.agent.source, {
    i1: { plan: [{ steps: [{ output: { summary: "S", decisions: [] } }] }] },
  });
});

test("YAML that is unsafe or ambiguous is refused", () => {
  rejects(`${WORLD}name: Twice\nactions: []\n`, "", /unique/i, 7);
  rejects(`${WORLD}actions:\n  - run: !shell { event: schedule }\n`, "", /tag/i, 8);
  const bomb = [
    "a: &a [x, x, x, x, x, x, x, x, x, x]",
    "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
    "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
    "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
    "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
  ].join("\n");
  rejects(bomb, "", /alias/i);
  rejects(
    `${WORLD}actions:\n  - run: { event: schedule }\n---\nname: Another\n`,
    "",
    /multiple documents/i,
  );
  // No merge keys: `<<` stays a key, which no mapping of the schema has.
  rejects(
    `${WORLD}actions:\n  - run: &run { event: schedule }\n  - run: { <<: *run }\n`,
    "actions[1].run.<<",
    /unknown field/,
  );
});

/** One of every action kind, nested in a `parallel` for some. */
const EVERY_ACTION = `name: Every action
tags: [schema]
runner: act
profiles: [ollama]
timeout: 20m
world:
  users: [mallory]
  organizations:
    - name: acme
      owners: [olivia]
      members: [carol]
      settings: "task-budget: 2\\n"
      variables: { CODEMAN_COMMIT_SHA: abc123 }
      secrets: [openrouter, runpod]
  repositories:
    - name: acme/app
      fixture: node-small
      maintainers: [alice]
      collaborators: { bob: triage }
      settings: { model: deepseek/deepseek-v4.1-flash }
      secrets: [openrouter]
    - { name: acme/site, fixture: node-small, maintainers: [alice], private: false, drafts: false }
  app:
    slug: codeman
    installations:
      - { owner: acme, repositories: [app, site], permissions: { issues: write, contents: write } }
  runpod:
    catalog: [{ id: NVIDIA L4, memory: 24, price: { secure: 0.4, community: 0.3 } }]
    endpoints: [{ id: ep1, workers: { max: 1 } }]
  openrouter: { credits: 10, prices: { prompt: 0.000001, completion: 0.000002 }, lags: { usage: 30s, analytics: hold } }
agent:
  i1:
    plan: [{ steps: [{ output: { summary: S, decisions: [] } }] }]
actions:
  - open-issue: { ref: i1, as: alice, repo: acme/app, title: Add a route, body: Details., labels: [codeman] }
  - comment: { issue: i1, as: mallory, body: /codeman approve }
  - comment: { pull: i1, as: alice, body: /codeman fix Shorter. }
  - label: { issue: i1, as: bob, label: codeman }
  - unlabel: { issue: i1, as: alice, label: codeman:blocked }
  - review: { pull: i1, as: alice, state: request-changes, body: Rename it., comments: [{ path: src/index.ts, line: 1, body: Here. }] }
  - close: { issue: i1, as: alice }
  - reopen: { issue: i1, as: alice }
  - push: { task: i1, as: alice, files: { src/index.ts: "export {};\\n", README.md: null }, message: Move it }
  - push: { repo: acme/site, branch: main, as: alice, files: {}, force: true }
  - set-variable: { org: acme, value: { task-budget: 5 } }
  - set-variable: { repo: acme/app, name: CODEMAN_COMMIT_SHA, value: def456 }
  - set-variable: { repo: acme/site, value: null }
  - seed: { doc: pools/acme/pods/n1, age: 45m, data: { status: serving, leases: [{ kind: keep, until: now+15m }], createdAt: now } }
  - run: { repo: acme/app, event: workflow_dispatch, inputs: { task-budget: 3, model: m }, max-runs: 2 }
  - advance: { repo: acme/app, until: { issue: i1, labels: [codeman:done] }, max-runs: 6 }
  - parallel:
      - - open-issue: { ref: i2, as: alice, repo: acme/site, title: Other }
        - run: { repo: acme/site, event: issues.labeled }
      - - wait: { until: { pods: [{ ref: p1, status: RUNNING }] }, timeout: 5m }
  - fault: { github: { method: POST, path: "/api/v3/repos/{owner}/{repo}/issues/{n}/comments", status: 502, times: 2 } }
  - fault: { openrouter: { path: /api/v1/keys, delay: 2s } }
  - fault: { openrouter: { lags: { analytics: 10m } } }
  - fault: { runpod: { pod-start: never } }
  - fault: { runpod: { hold-queues: [ep1] } }
  - fault: { google: { refuse-repositories: [acme/site], expiry: 1m } }
  - fault: { llm: { path: /v1/chat/completions, drop: true } }
  - fault: { pod: { pod: p1, action: exit } }
  - fault: { job: { name: next-run, issue: i2, conclusion: cancelled, times: 1 } }
  - fault: { firestore: down }
  - fault: { clear: all }
  - apply: skip
  - apply: { mode: fail, issue: i2 }
  - wait: { until: { issue: i2, comments: [{ kind: run, count: { at-least: 1 } }] }, timeout: 2m }
  - expect:
      issue: i1
      labels: [codeman:done]
      no-labels: [codeman:blocked]
      comments:
        - { kind: decisions, contains: [Which port?, "8080"], by: "codeman[bot]" }
        - { kind: run, count: 3 }
      commits: { count: 2, files: [src/health.ts], no-files: [vendor/repo/.git], message: health }
      pull-request: { ready: true, state: open, files: [src/health.ts] }
      store:
        - { doc: pools/acme/pods/n1, fields: { status: ended, live: false } }
        - { collection: organizations/acme/runs, where: { status: closed, cost: { at-most: 0.5 } }, count: 4 }
        - { doc: contexts/abc, absent: true }
      ledger: { cost-at-most: 2, cost-at-least: 0.01, runs: { at-most: 6 } }
      fakes:
        github: { dispatches: { count: 1 }, violations: { count: 0 } }
        openrouter: { keys: { where: { disabled: true } } }
        llm: { turns: {} }
      pods:
        - { pod: p1, status: TERMINATED, where: { gpu: NVIDIA L4 } }
        - { status: RUNNING, count: 0 }
      engine: { pod: p1, ollama: { models: [{ name: "qwen2.5:0.5b" }] }, gateway: { seats: { at-least: 2 } } }
      violations: none
`;

test("every action kind parses", () => {
  const scenario = parse(EVERY_ACTION);
  const kinds = new Set<string>();
  const visit = (actions: Action[]) => {
    for (const action of actions) {
      kinds.add(action.kind);
      if (action.kind === "parallel") action.branches.forEach(visit);
    }
  };
  visit(scenario.actions);
  assert.deepEqual([...kinds].sort(), [...ACTION_KINDS].sort());
  assert.equal(scenario.runner, "act");
  assert.equal(scenario.timeoutMs, 20 * 60 * 1000);
  assert.deepEqual(scenario.world.openrouter?.lags, { usageMs: 30_000, analyticsMs: null });

  const byKind = (kind: string) => scenario.actions.filter((action) => action.kind === kind);
  assert.deepEqual(byKind("push")[0], {
    kind: "push",
    as: "alice",
    repo: "acme/app",
    branch: { task: "i1" },
    files: { "src/index.ts": "export {};\n", "README.md": null },
    message: "Move it",
    base: undefined,
    force: false,
  });
  assert.deepEqual(
    byKind("set-variable").map((action) => action.kind === "set-variable" && action.value),
    ["task-budget: 5\n", "def456", null],
  );
  const seed = byKind("seed")[0];
  assert.ok(seed?.kind === "seed");
  const lease = (seed.data.leases as { until: unknown }[])[0]?.until;
  assert.ok(lease instanceof RelativeTime);
  assert.equal(lease.offsetMs, -30 * 60 * 1000);
  assert.equal((seed.data.createdAt as RelativeTime).offsetMs, -45 * 60 * 1000);
  assert.deepEqual(byKind("run")[0], {
    kind: "run",
    repo: "acme/app",
    event: "workflow_dispatch",
    inputs: { "task-budget": "3", model: "m" },
    maxRuns: 2,
  });
  assert.deepEqual(
    byKind("fault").map((fault) => fault.kind === "fault" && fault.target),
    [
      "http",
      "http",
      "openrouter",
      "runpod",
      "runpod",
      "google",
      "http",
      "pod",
      "job",
      "firestore",
      "clear",
    ],
  );
  const expectation = byKind("expect")[0];
  assert.ok(expectation?.kind === "expect");
  assert.deepEqual(expectation.store?.[1], {
    collection: "organizations/acme/runs",
    where: {
      status: { kind: "equals", value: "closed" },
      cost: { kind: "range", atLeast: undefined, atMost: 0.5 },
    },
    count: { kind: "equals", value: 4 },
  });
  assert.deepEqual(
    expectation.fakes?.map((match) => `${match.fake}.${match.list}`),
    ["github.dispatches", "github.violations", "openrouter.keys", "llm.turns"],
  );
});

test("names that the world or the store do not have fail", () => {
  rejects(
    `${WORLD}actions:\n  - seed: { doc: pools/acme/pods, data: {} }\n`,
    "actions[0].seed.doc",
    /expected a doc of the store: organizations\/\*, organizations\/\*\/runs\/\*/,
  );
  rejects(
    `${WORLD}actions:\n  - expect: { fakes: { runpod: { pods: {} } } }\n`,
    "actions[0].expect.fakes.runpod.pods",
    /expected one of jobs, requests/,
  );
  rejects(
    `${WORLD}actions:\n  - run: { repo: acme/other, event: schedule }\n`,
    "actions[0].run.repo",
    /no repository acme\/other in the world/,
  );
  rejects(
    `${WORLD}actions:\n  - fault: { job: { name: deploy } }\n`,
    "actions[0].fault.job.name",
    /expected one of forward-review, select/,
  );
  rejects(
    `${WORLD}actions:\n  - fault: { github: { path: /api/v3/user } }\n`,
    "actions[0].fault.github",
    /expected status, delay or drop/,
  );
  rejects(
    `${WORLD}  runpod: { endpoints: [{ id: "bad id" }] }\nactions:\n  - run: { event: schedule }\n`,
    "world.runpod.endpoints[0]",
    /An endpoint has id/,
  );
});

test("an unknown key fails wherever the shape is fixed, the fakes' own shapes included", () => {
  const endpoint = (workers: string) => `${WORLD}  runpod:
    endpoints:
      - { id: e1, workers: ${workers}, gpu: { pools: [AMPERE_48] } }
actions:
  - run: { event: schedule }
`;
  parse(endpoint("{ min: 0, max: 1, idleTimeout: 5 }"));
  rejects(
    endpoint("{ min: 0, idle-timeout: 5 }"),
    "world.runpod.endpoints[0]",
    /no field workers\.idle-timeout/,
  );
  rejects(
    `${WORLD}  runpod:
    endpoints: [{ id: e1, gpu: { pool: AMPERE_48 } }]
actions:
  - run: { event: schedule }
`,
    "world.runpod.endpoints[0]",
    /no field gpu\.pool;/,
  );
  rejects(
    `${WORLD}  runpod:
    catalog: [{ id: NVIDIA RTX A6000, memory: 48, price: { secure: 1, spot: 0.5 } }]
actions:
  - run: { event: schedule }
`,
    "world.runpod.catalog[0]",
    /no field price\.spot/,
  );
  rejects(
    `${WORLD}  runpod:
    catalog: [{ id: NVIDIA RTX A6000, cudaVersions: [{ version: "12.8", availible: true }] }]
actions:
  - run: { event: schedule }
`,
    "world.runpod.catalog[0]",
    /no field cudaVersions\[0\]\.availible/,
  );
  rejects(
    `${WORLD}agent:
  i1:
    code: [{ steps: [{ write: { path: a.ts, content: x, mode: "755" } }] }]
actions:
  - open-issue: { ref: i1, as: alice, title: T }
`,
    "agent.i1.code[0].steps[0].write.mode",
    /absent: expected path, content/,
  );
  rejects(
    `${WORLD}agent:
  i1:
    code: [{ usage: { prompt: 1, completion: 1, reasoning: 1 }, steps: [] }]
actions:
  - open-issue: { ref: i1, as: alice, title: T }
`,
    "agent.i1.code[0].usage.reasoning",
    /absent/,
  );
});

test("a fault makes the fake Runpod's pod creation answer 402", () => {
  const scenario = parse(`${WORLD}actions:
  - fault: { runpod: { low-balance: true } }
`);
  assert.deepEqual(scenario.actions[0], {
    kind: "fault",
    target: "runpod",
    runpod: { lowBalance: true },
  });
  rejects(
    `${WORLD}actions:
  - fault: { runpod: { balance: low } }
`,
    "actions[0].fault.runpod.balance",
    /unknown field/,
  );
});
