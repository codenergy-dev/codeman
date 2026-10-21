// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the tests hold workflow expressions, not JavaScript templates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { hasGit } from "../../fakes/github/git.ts";
import { type Command, RecordingExecutor } from "./executor.ts";
import { writeOutputs } from "./files.ts";
import { expandMatrix } from "./simulator.ts";
import { byName, dispatch, results, setup } from "./testing.ts";

const skip = hasGit() ? false : "git is not on the PATH";

/**
 * A scripted shell: each line of a `run:` is `out <name>=<value>`, `fail`, or `wait <ms>`, which
 * a cancellation cuts short. It tracks how many commands run at once.
 */
function scripted() {
  let running = 0;
  const peak = { value: 0 };
  const executor = new RecordingExecutor(async (command: Command) => {
    if (command.kind !== "run") return undefined;
    running++;
    peak.value = Math.max(peak.value, running);
    try {
      for (const line of command.script.split("\n")) {
        const [verb, rest = ""] = line.trim().split(/ (.*)/s);
        if (verb === "out") {
          const [name = "", value = ""] = rest.split(/=(.*)/s);
          writeOutputs(command.env, { [name]: value });
        } else if (verb === "fail") {
          return { exitCode: 1, output: "failed\n" };
        } else if (verb === "wait") {
          await sleep(Number(rest), undefined, { signal: command.signal }).catch(() => undefined);
          if (command.signal.aborted) return { exitCode: 143, output: "cancelled\n" };
        }
      }
      return { exitCode: 0, output: "" };
    } finally {
      running--;
    }
  });
  return { executor, peak };
}

// A block scalar ends with a newline: scripts from step() do, one-line run: values do not.
const step = (script: string) =>
  `    runs-on: ubuntu-latest\n    steps:\n      - id: s\n        run: |\n          ${script.split("\n").join("\n          ")}\n`;

test("a skipped or failed ancestor skips the jobs after it, unless their if calls a status function", {
  skip,
}, async () => {
  const { executor } = scripted();
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
jobs:
  a:
${step("out x=1")}    outputs:
      x: \${{ steps.s.outputs.x }}
  b:
    needs: a
    if: needs.a.outputs.x == '2'
${step("true")}  c:
    needs: b
    if: always() && needs.b.result == 'skipped'
${step("true")}  d:
    needs: c
${step("true")}  e:
    needs: a
    if: failure()
${step("true")}  f:
    needs: a
${step("fail")}  g:
    needs: f
${step("true")}  h:
    needs: f
    if: failure()
${step("true")}  i:
    needs: [c, f]
    if: always() && needs.f.result == 'failure' && needs.c.result == 'success'
${step("true")}`,
    },
    executor,
  );
  const result = await dispatch(simulator);
  assert.deepEqual(results(result), {
    a: "success",
    b: "skipped",
    e: "skipped",
    f: "failure",
    c: "success",
    g: "skipped",
    h: "success",
    // d needs c, which succeeded, but c's ancestor b was skipped: success() is false.
    d: "skipped",
    i: "success",
  });
  assert.equal(result.conclusion, "failure");
  assert.equal(result.graph.a?.outputs.x, "1");
});

test("steps: outputs, outcome and conclusion, continue-on-error, and job outputs", {
  skip,
}, async () => {
  const { executor } = scripted();
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
jobs:
  a:
    runs-on: ubuntu-latest
    outputs:
      word: \${{ steps.one.outputs.word }}
      outcome: \${{ steps.two.outcome }}/\${{ steps.two.conclusion }}
      leak: \${{ secrets.TOP_SECRET }}
    steps:
      - id: one
        run: out word=hello
      - id: two
        run: fail
        continue-on-error: true
      - id: three
        if: failure()
        run: out never=1
      - id: four
        run: out seen=\${{ steps.one.outputs.word }}
  b:
    needs: a
    runs-on: ubuntu-latest
    steps:
      - run: out got=\${{ needs.a.outputs.word }}
        env:
          OUTCOME: \${{ needs.a.outputs.outcome }}
`,
    },
    executor,
  );
  const result = await dispatch(simulator);
  const jobs = byName(result);
  assert.equal(jobs.a?.result, "success");
  assert.deepEqual(
    jobs.a?.steps.map((entry) => [entry.id, entry.outcome, entry.conclusion]),
    [
      ["one", "success", "success"],
      ["two", "failure", "success"],
      ["three", "skipped", "skipped"],
      ["four", "success", "success"],
    ],
  );
  assert.deepEqual(jobs.a?.steps[3]?.outputs, { seen: "hello" });
  // An output holding a secret is not sent.
  assert.deepEqual(jobs.a?.outputs, { word: "hello", outcome: "failure/success" });
  assert.match(jobs.a?.log ?? "", /Skip output 'leak' since it may contain secret/);
  const b = executor.of("b")[0];
  assert.equal(b?.script, "out got=hello");
  assert.equal(b?.env.OUTCOME, "failure/success");
});

test("a matrix from fromJSON: include, fail-fast and max-parallel", { skip }, async () => {
  const { executor, peak } = scripted();
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on:
  workflow_dispatch:
    inputs:
      legs: { type: string }
      fail-fast: { type: boolean }
jobs:
  list:
${step("out legs=${{ inputs.legs }}")}    outputs:
      legs: \${{ steps.s.outputs.legs }}
  leg:
    name: "#\${{ matrix.task }}"
    needs: list
    strategy:
      fail-fast: \${{ inputs.fail-fast }}
      max-parallel: 2
      matrix:
        include: \${{ fromJSON(inputs.legs) }}
${step("wait 30\nout task=${{ matrix.task }}\n${{ matrix.fail && 'fail' || 'true' }}\nwait 30")}    outputs:
      task: \${{ steps.s.outputs.task }}
`,
    },
    executor,
  );
  const legs = JSON.stringify([
    { task: "1" },
    { task: "2" },
    { task: "3", fail: true },
    { task: "4" },
    { task: "5" },
  ]);
  const tolerant = await dispatch(simulator, { legs, "fail-fast": "false" });
  assert.deepEqual(
    tolerant.jobs
      .filter((job) => job.id === "leg")
      .map((job) => [job.name, job.result])
      .sort(),
    [
      ["#1", "success"],
      ["#2", "success"],
      ["#3", "failure"],
      ["#4", "success"],
      ["#5", "success"],
    ],
  );
  assert.equal(peak.value, 2, "max-parallel");
  assert.equal(tolerant.graph.leg?.result, "failure");

  const strict = await dispatch(simulator, { legs, "fail-fast": "true" });
  const strictLegs = Object.fromEntries(
    strict.jobs.filter((job) => job.id === "leg").map((job) => [job.name, job.result]),
  );
  assert.equal(strictLegs["#3"], "failure");
  assert.equal(strictLegs["#5"], "cancelled", "a leg not started is cancelled");
  assert.ok(["cancelled", "success"].includes(strictLegs["#4"] ?? ""));
  assert.equal(strict.graph.leg?.result, "failure");

  const empty = await dispatch(simulator, { legs: "[]", "fail-fast": "false" });
  assert.equal(empty.graph.leg?.result, "failure");
  assert.match(
    empty.jobs.find((job) => job.id === "leg")?.error ?? "",
    /does not contain any values/,
  );
});

test("a matrix expands as GitHub documents include and exclude", () => {
  assert.deepEqual(
    expandMatrix({
      fruit: ["apple", "pear"],
      animal: ["cat", "dog"],
      include: [
        { color: "green" },
        { color: "pink", animal: "cat" },
        { fruit: "apple", shape: "circle" },
        { fruit: "banana" },
        { fruit: "banana", animal: "cat" },
      ],
    }),
    [
      { fruit: "apple", animal: "cat", color: "pink", shape: "circle" },
      { fruit: "apple", animal: "dog", color: "green", shape: "circle" },
      { fruit: "pear", animal: "cat", color: "pink" },
      { fruit: "pear", animal: "dog", color: "green" },
      { fruit: "banana" },
      { fruit: "banana", animal: "cat" },
    ],
  );
  assert.deepEqual(expandMatrix({ os: ["a", "b"], v: [1, 2], exclude: [{ os: "a", v: 2 }] }), [
    { os: "a", v: 1 },
    { os: "b", v: 1 },
    { os: "b", v: 2 },
  ]);
  assert.throws(() => expandMatrix({ include: [] }), /does not contain any values/);
});

const CALLED = `on:
  workflow_call:
    inputs:
      task: { type: string, required: true }
      flag: { type: boolean, required: false }
    secrets:
      KEY: { required: false }
    outputs:
      done:
        value: \${{ jobs.work.outputs.done }}
permissions: {}
jobs:
  work:
    name: Work
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    outputs:
      done: \${{ steps.s.outputs.done }}
    steps:
      - id: s
        run: |
          out done=task-\${{ inputs.task }}-\${{ inputs.flag }}
          \${{ inputs.task == '2' && 'fail' || 'true' }}
        env:
          KEY: \${{ secrets.KEY }}
  after:
    name: After
    needs: work
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: out result=\${{ needs.work.result }}
`;

test("a reusable workflow as a matrix: a failed inner job fails the call, and the caller's always() jobs still run", {
  skip,
}, async () => {
  const { executor } = scripted();
  const { simulator, identities } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
permissions: {}
jobs:
  task:
    name: "#\${{ matrix.task }}"
    strategy:
      fail-fast: false
      matrix:
        task: ["1", "2"]
    uses: ./.github/workflows/task.yml
    permissions:
      contents: read
      id-token: write
    with:
      task: \${{ matrix.task }}
      flag: true
    secrets:
      KEY: \${{ secrets.TOP_SECRET }}
  next:
    needs: task
    if: always() && needs.task.result == 'failure'
${step("out done=${{ needs.task.outputs.done }}")}  plain:
    needs: task
${step("true")}`,
      ".github/workflows/task.yml": CALLED,
    },
    executor,
  );
  const result = await dispatch(simulator);
  assert.deepEqual(results(result), {
    "#1 / Work": "success",
    "#2 / Work": "failure",
    "#1 / After": "success",
    "#2 / After": "success",
    next: "success",
    plain: "skipped",
  });
  assert.equal(result.graph.task?.result, "failure");
  // Only the successful leg's output is kept.
  assert.deepEqual(result.graph.task?.outputs, { done: "task-1-true" });
  assert.equal(executor.of("next")[0]?.script, "out done=task-1-true\n");
  assert.equal(executor.of("#1 / Work")[0]?.env.KEY, "s3cr3t-value");
  assert.ok(!byName(result)["#1 / Work"]?.log.includes("s3cr3t-value"));
  assert.equal(executor.of("#2 / After")[0]?.script, "out result=failure");
  // The OIDC token names the called workflow as the job's.
  assert.deepEqual(
    identities.map((identity) => [identity.workflowFile, identity.jobWorkflowFile]),
    [["main.yml", "task.yml"]],
  );
  assert.deepEqual(byName(result)["#1 / After"]?.permissions, {});
});

test("a called workflow's job may not ask for more than the calling job grants", {
  skip,
}, async () => {
  const { executor } = scripted();
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
jobs:
  task:
    uses: ./.github/workflows/task.yml
    permissions:
      contents: read
    with:
      task: "1"
`,
      ".github/workflows/task.yml": CALLED,
    },
    executor,
  );
  const result = await dispatch(simulator);
  assert.equal(result.conclusion, "startup_failure");
  assert.match(
    result.error ?? "",
    /The nested job 'work' is requesting 'id-token: write', but is only allowed 'id-token: none'/,
  );
  assert.equal(executor.commands.length, 0);
});

test("each job gets GitHub's environment, its run's ID, and a token with its permissions", {
  skip,
}, async () => {
  const { executor } = scripted();
  const { simulator, fake } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
permissions: {}
jobs:
  oidc:
    permissions:
      id-token: write
      issues: write
      pull-requests: read
${step("true")}  plain:
${step("true")}`,
    },
    executor,
  );
  const first = await dispatch(simulator);
  const second = await dispatch(simulator);
  assert.notEqual(first.id, second.id);
  const oidc = byName(first).oidc;
  const plain = byName(first).plain;
  assert.ok(oidc && plain);
  assert.equal(oidc.env.GITHUB_RUN_ID, String(first.id));
  assert.equal(byName(second).oidc?.env.GITHUB_RUN_ID, String(second.id));
  assert.equal(oidc.env.GITHUB_REPOSITORY, "acme/app");
  assert.equal(oidc.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(oidc.env.GITHUB_API_URL, "https://github-e2e.localhost:8443/api/v3");
  assert.match(oidc.env.RUNNER_TEMP ?? "", /\/_temp$/);
  assert.match(oidc.env.GITHUB_WORKSPACE ?? "", /\/app\/app$/);
  assert.ok(oidc.env.ACTIONS_RUNTIME_TOKEN);
  assert.equal(
    oidc.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    "https://github-e2e.localhost:8443/oidc/token?api-version=2.0",
  );
  assert.notEqual(
    oidc.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    byName(second).oidc?.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  );
  assert.equal(
    plain.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    undefined,
    "no OIDC without id-token: write",
  );
  assert.equal(oidc.env.GITHUB_TOKEN, undefined);
  // The fake holds the job tokens with the jobs' permissions, and enforces them.
  assert.deepEqual(fake.world.tokens.get(oidc.token ?? "")?.permissions, {
    issues: "write",
    pull_requests: "read",
    metadata: "read",
  });
  assert.deepEqual(fake.world.tokens.get(plain.token ?? "")?.permissions, { metadata: "read" });
  const run = fake.world.run(first.id);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.deepEqual(run.jobs.map((job) => [job.name, job.conclusion]).sort(), [
    ["oidc", "success"],
    ["plain", "success"],
  ]);
});

test("an expression outside the subset stops the run before it starts", { skip }, async () => {
  const { executor } = scripted();
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
jobs:
  a:
    if: hashFiles('x') != ''
${step("true")}`,
    },
    executor,
  );
  await assert.rejects(
    simulator.start({
      repository: "acme/app",
      workflow: ".github/workflows/main.yml",
      event: "workflow_dispatch",
    }),
    /\.github\/workflows\/main\.yml: jobs\.a\.if: \$\{\{ hashFiles\('x'\) != '' \}\}: the function hashFiles is not supported/,
  );
});
