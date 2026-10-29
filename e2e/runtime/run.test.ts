import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { MemoryStore } from "../../src/store/memory.ts";
import { hasGit } from "../fakes/github/git.ts";
import { GitHubFake } from "../fakes/github/github.ts";
import { GoogleFake } from "../fakes/google/google.ts";
import { FakeServer } from "../fakes/http.ts";
import { LlmFake } from "../fakes/llm/llm.ts";
import { OpenRouterFake } from "../fakes/openrouter/openrouter.ts";
import { RunpodFake } from "../fakes/runpod/runpod.ts";
import { SaladFake } from "../fakes/salad/salad.ts";
import { FakeClient, type Fakes } from "./fakes.ts";
import type { JobFault } from "./faults.ts";
import { FaultingExecutor } from "./faults.ts";
import { RemoteGitHub } from "./github.ts";
import { Timeline } from "./report.ts";
import { ScenarioFailure, ScenarioRun } from "./run.ts";
import { parseScenario, SCENARIOS_ROOT } from "./scenario/load.ts";
import type { Scenario } from "./scenario/schema.ts";
import { type Handler, RecordingExecutor } from "./simulator/executor.ts";
import { writeOutputs } from "./simulator/files.ts";
import { Simulator } from "./simulator/simulator.ts";
import { buildWorld, CODEMAN } from "./world.ts";

/**
 * The runtime's actions against the fakes in this process, over their HTTP and control APIs as
 * in Compose, with the control token; the jobs run nothing (a recording executor answers
 * Codeman's step as a select that picks no task), so no Docker is needed.
 */

const skip = hasGit() ? false : "git is not on the PATH";
const TOKEN = "unit-control-token";

const servers: { close(): Promise<void> }[] = [];
let fakes: Fakes;
let github: RemoteGitHub;

before(async () => {
  if (skip) return;
  const listen = async (
    name: string,
    server: { listen(o: object): Promise<string>; close(): Promise<void> },
  ) => {
    servers.push(server);
    return new FakeClient(name, await server.listen({ controlToken: TOKEN }), { token: TOKEN });
  };
  const githubFake = new GitHubFake();
  const google = new GoogleFake({
    provider: "projects/1/locations/global/workloadIdentityPools/p/providers/q",
    serviceAccounts: [],
    condition: () => false,
  });
  fakes = {
    github: await listen("github", githubFake),
    google: await listen("google", google.server),
    llm: await listen("llm", new LlmFake().server),
    openrouter: await listen("openrouter", new OpenRouterFake({ managementKey: "m" }).server),
    runpod: await listen("runpod", new RunpodFake().server),
    salad: await listen("salad", new SaladFake().server),
    npm: await listen("npm", new FakeServer("npm")),
    huggingface: await listen("huggingface", new FakeServer("huggingface")),
    firestore: "http://127.0.0.1:1",
  };
  github = new RemoteGitHub(fakes.github, { server: fakes.github.origin });
});

after(async () => {
  for (const server of servers) await server.close();
});

const SCENARIO = `name: The runtime's actions, in process
tags: [unit]
world:
  organizations:
    - { name: acme, settings: { model: deepseek/deepseek-v4.1-flash } }
  repositories:
    - { name: acme/app, fixture: node-small, maintainers: [alice], collaborators: { bob: read } }
agent:
  i1:
    plan:
      - steps: [{ output: { summary: Plans., decisions: [] } }]
actions:
  - open-issue: { ref: i1, as: alice, title: Add a route, labels: [codeman] }
  - comment: { issue: i1, as: alice, body: Looks good. }
  - set-variable: { repo: acme/app, name: EXTRA, value: "1" }
  - seed: { doc: organizations/acme, data: { note: seeded, at: now-1h } }
  - parallel:
      - [{ comment: { issue: i1, as: bob, body: From one branch. } }]
      - [{ expect: { issue: i1, labels: [codeman] } }]
  - run: { event: issues.labeled }
  - label: { issue: i1, as: alice, label: bug }
  - expect:
      issue: i1
      labels: [codeman, bug]
      no-labels: [codeman:done]
      comments: [{ contains: Looks good., by: alice }, { contains: From one branch., count: 1 }]
      store: [{ doc: organizations/acme, fields: { note: seeded } }]
  - fault: { github: { path: /api/v3/meta, status: 503, times: 1 } }
  - wait: { until: { issue: i1, labels: [bug] }, timeout: 5s }
  - advance: { until: { issue: i1, labels: [bug] }, max-runs: 1 }
`;

function scenario(text = SCENARIO): Scenario {
  return parseScenario(text, join(SCENARIOS_ROOT, "unit", "actions.yaml"));
}

/** A world on the reset fakes, a simulator whose select picks nothing, and the run. */
async function start(text?: string, handler?: Handler) {
  for (const client of [
    fakes.github,
    fakes.google,
    fakes.llm,
    fakes.openrouter,
    fakes.runpod,
    fakes.npm,
  ]) {
    await client.reset();
  }
  github.forget();
  const chosen = scenario(text);
  const world = await buildWorld(chosen, github, fakes);
  const recording = new RecordingExecutor(
    handler ??
      ((command) => {
        if (command.kind === "action") {
          writeOutputs(command.env, {
            action: "none",
            tasks: "[]",
            dispatches: "[]",
          });
        }
        return undefined;
      }),
  );
  const jobFaults: JobFault[] = [];
  const timeline = new Timeline();
  const store = new MemoryStore();
  let simulator: Simulator | undefined;
  simulator = new Simulator({
    github,
    executor: new FaultingExecutor(recording, jobFaults, "/home/runner/work", (runId) =>
      simulator?.runs.find((one) => one.id === runId)?.cancel(),
    ),
    secrets: (repository) => world.secrets(repository),
    vars: (repository) => world.vars(repository),
    oidc: {
      requestUrl: `${fakes.google.origin}/oidc/token?api-version=2.0`,
      register: async (identity) =>
        (await fakes.google.json<{ token: string }>("POST", "/google/runs", identity)).token,
    },
  });
  const run = new ScenarioRun({
    scenario: chosen,
    github,
    fakes,
    store,
    simulator,
    world,
    timeline,
    jobFaults,
    expectTimeoutMs: 1500,
  });
  return { chosen, world, recording, run, timeline, store, simulator };
}

test("each action runs against the fakes, a run through the simulator included", {
  skip,
}, async () => {
  const { chosen, world, recording, run, timeline } = await start();
  await run.runAll(chosen.actions);
  await run.finish();

  // The world: Codeman's repository, whose main CODEMAN_COMMIT_SHA names, and the scenario's.
  const codeman = await github.resolve(`${CODEMAN.owner}/${CODEMAN.name}`, "main");
  assert.equal(world.vars("acme/app").CODEMAN_COMMIT_SHA, codeman);
  assert.equal(world.vars("acme/app").EXTRA, "1");
  assert.match(world.vars("acme/app").CODEMAN_SETTINGS ?? "", /model: deepseek/);
  assert.ok(world.secrets("acme/app").CODEMAN_GITHUB_APP_PRIVATE_KEY?.includes("PRIVATE KEY"));

  // The issue's body carries the marker the scripted model reads.
  const [issue] = await github.issues("acme/app");
  assert.match(issue?.body ?? "", /<!-- codeman-e2e scenario=unit\/actions issue=i1 -->/);

  // The run: the select job got its App token from the fake over its REST API, and ran Codeman.
  const select = recording.of("Select tasks");
  assert.equal(select.find((command) => command.kind === "action")?.inputs?.step, "select");
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0]?.conclusion, "success");
  assert.ok(
    timeline.events.some((event) => event.kind === "expect" && event.text.startsWith("holds")),
  );

  // The fault reached the fake GitHub's own routes.
  const meta = await fakes.github.request("GET", "/api/v3/meta", { ok: () => true });
  assert.equal(meta.status, 503);

  // The script reached the scripted model, under the scenario's ID.
  const scripts = await fakes.llm.json<Record<string, unknown>>("GET", "/llm/scripts");
  assert.ok("unit/actions" in scripts);
});

test("a failing expect says what does not hold", { skip }, async () => {
  const { run } = await start(
    SCENARIO.replace(
      /actions:\n[\s\S]*$/,
      `actions:
  - open-issue: { ref: i1, as: alice, title: Add a route, labels: [codeman] }
  - expect: { issue: i1, labels: [codeman:done], comments: [{ kind: decisions }] }
`,
    ),
  );
  await assert.rejects(
    run.runAll(run.context.scenario.actions),
    (error: unknown) =>
      error instanceof ScenarioFailure &&
      /lacks the label codeman:done; it has codeman/.test(error.message) &&
      /no a decisions comment/.test(error.message),
  );
});

test("an advance with nothing left to run fails, naming what does not hold", { skip }, async () => {
  const { run } = await start(
    SCENARIO.replace(
      /actions:\n[\s\S]*$/,
      `actions:
  - open-issue: { ref: i1, as: alice, title: Add a route }
  - advance: { until: { issue: i1, labels: [codeman:done] }, max-runs: 3 }
`,
    ),
  );
  await assert.rejects(
    run.runAll(run.context.scenario.actions),
    /nothing left to run on acme\/app after 0 runs/,
  );
});

test("a token the fake GitHub did not give fails the scenario at its end", { skip }, async () => {
  const { run } = await start(
    SCENARIO.replace(
      /actions:\n[\s\S]*$/,
      `actions:
  - open-issue: { ref: i1, as: alice, title: Add a route }
`,
    ),
  );
  await run.runAll(run.context.scenario.actions);
  await fakes.github.request("GET", "/api/v3/repos/acme/app", {
    headers: { authorization: "Bearer ghs_not-a-token-the-fake-gave" },
    ok: () => true,
  });
  await assert.rejects(run.finish(), /violation: unknown-token/);
});

test("a job fault fails the job without running it", { skip }, async () => {
  const { run, recording } = await start(
    SCENARIO.replace(
      /actions:\n[\s\S]*$/,
      `actions:
  - open-issue: { ref: i1, as: alice, title: Add a route, labels: [codeman] }
  - fault: { job: { name: select, times: 1 } }
  - run: { event: issues.labeled }
`,
    ),
  );
  await run.runAll(run.context.scenario.actions);
  assert.equal(run.results[0]?.conclusion, "failure");
  assert.equal(recording.of("Select tasks").length, 0);
});

/**
 * Codeman's steps as a record-only run answers them: the first select picks task 1 to record,
 * apply moves it, and `next-run` dispatches the workflow once, whose select then picks nothing.
 */
function chain(): Handler {
  let selects = 0;
  let dispatched = false;
  return async (command, job) => {
    const temp = command.env.RUNNER_TEMP ?? "";
    if (command.kind === "run" && job.name === "Next run" && !dispatched) {
      dispatched = true;
      await fakes.github.request(
        "POST",
        "/api/v3/repos/acme/app/actions/workflows/codeman.yml/dispatches",
        { headers: { authorization: `Bearer ${command.env.GH_TOKEN}` }, body: { ref: "main" } },
      );
      return undefined;
    }
    if (command.kind !== "action") return undefined;
    if (command.inputs.step === "select" && ++selects === 1) {
      mkdirSync(join(temp, "codeman", "task"), { recursive: true });
      writeFileSync(join(temp, "codeman", "task", "1.json"), "{}\n");
      const task = {
        task: "1",
        action: "record",
        "needs-agent": "false",
        stage: "",
        "base-sha": "a".repeat(40),
        "task-budget": "2",
        "monthly-budget": "20",
        "organization-monthly-budget": "",
        inference: "{}",
        "ledger-run": "",
      };
      writeOutputs(command.env, {
        action: "record",
        tasks: JSON.stringify([task]),
        dispatches: "[]",
      });
    } else if (command.inputs.step === "select") {
      writeOutputs(command.env, { action: "none", tasks: "[]", dispatches: "[]" });
    } else if (command.inputs.step === "apply") {
      mkdirSync(join(temp, "codeman", "chain"), { recursive: true });
      writeFileSync(join(temp, "codeman", "chain", "1"), "");
      writeOutputs(command.env, { chain: "true", continues: "false" });
    }
    return undefined;
  };
}

const CHAIN = (actions: string) =>
  SCENARIO.replace(
    /actions:\n[\s\S]*$/,
    `actions:\n  - open-issue: { ref: i1, as: alice, title: Add a route, labels: [codeman] }\n${actions}`,
  );

test("a run runs the chain its next-run dispatches at once, but not users' later events", {
  skip,
}, async () => {
  const { run, recording } = await start(
    CHAIN(`  - run: { event: issues.labeled }
  - comment: { issue: i1, as: alice, body: /codeman decide 1 a }
`),
    chain(),
  );
  await run.runAll(run.context.scenario.actions);
  // The labeled event's run, then the dispatched one; the comment waits for an advance.
  assert.deepEqual(
    run.results.map((result) => [result.event, result.conclusion]),
    [
      ["issues", "success"],
      ["workflow_dispatch", "success"],
    ],
  );
  assert.equal(recording.of("Select tasks").filter((one) => one.kind === "action").length, 2);
});

test("a run whose chain goes on past its max-runs fails", { skip }, async () => {
  const { run } = await start(CHAIN("  - run: { event: issues.labeled, max-runs: 0 }\n"), chain());
  await assert.rejects(
    run.runAll(run.context.scenario.actions),
    /chain on acme\/app still runs after 0 more runs \(max-runs 0\)/,
  );
});

test("apply: skip cancels the run as apply reaches Codeman's step; always() jobs still run", {
  skip,
}, async () => {
  const { run, recording } = await start(
    CHAIN(`  - apply: { mode: skip }
  - run: { event: issues.labeled, max-runs: 0 }
`),
    chain(),
  );
  await assert.rejects(run.runAll(run.context.scenario.actions), /still runs after 0/);
  const [first] = run.results;
  assert.equal(first?.conclusion, "cancelled");
  const jobs = Object.fromEntries((first?.jobs ?? []).map((job) => [job.name, job]));
  assert.equal(jobs["#1 / Apply"]?.result, "cancelled", jobs["#1 / Apply"]?.log);
  // apply's Codeman step never ran; next-run, whose if: has always(), ran and dispatched.
  assert.equal(recording.of("#1 / Apply").filter((one) => one.kind === "action").length, 0);
  const applySteps = jobs["#1 / Apply"]?.steps.map((step) => step.outcome);
  assert.ok(applySteps?.includes("cancelled"), JSON.stringify(applySteps));
  assert.equal(jobs["Next run"]?.result, "success", jobs["Next run"]?.log);
});

test("a cancelled job fault cancels its run before the job's Codeman step", { skip }, async () => {
  const { run, recording } = await start(
    CHAIN(`  - fault: { job: { name: select, conclusion: cancelled, times: 1 } }
  - run: { event: issues.labeled }
`),
    chain(),
  );
  await run.runAll(run.context.scenario.actions);
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0]?.conclusion, "cancelled");
  const select = run.results[0]?.jobs.find((job) => job.name === "Select tasks");
  assert.equal(select?.result, "cancelled");
  // Its first step ran; Codeman's did not; next-run, whose if: needs select's success, did not.
  assert.ok(recording.of("Select tasks").some((one) => one.kind === "run"));
  assert.equal(recording.of("Select tasks").filter((one) => one.kind === "action").length, 0);
  assert.equal(recording.of("Next run").length, 0);
});
