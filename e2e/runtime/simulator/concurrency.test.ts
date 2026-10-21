import assert from "node:assert/strict";
import { test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { type Command, RecordingExecutor } from "./executor.ts";
import type { SimRun } from "./simulator.ts";
import { setup } from "./testing.ts";

const skip = hasGit() ? false : "git is not on the PATH";

/** Steps that wait at a gate, one per run, until the test opens it or the run is cancelled. */
function gates() {
  const open = new Map<number, () => void>();
  const arrived = new Map<number, () => void>();
  const arrivals = new Map<number, Promise<void>>();
  const arrival = (runId: number) => {
    let promise = arrivals.get(runId);
    if (!promise) {
      promise = new Promise((resolve) => arrived.set(runId, resolve));
      arrivals.set(runId, promise);
    }
    return promise;
  };
  const executor = new RecordingExecutor(async (command: Command, job) => {
    arrival(job.runId);
    arrived.get(job.runId)?.();
    await new Promise<void>((resolve) => {
      open.set(job.runId, resolve);
      command.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    return { exitCode: command.signal.aborted ? 143 : 0, output: "" };
  });
  return {
    executor,
    /** Resolves when the run's job is at its gate. */
    arrival,
    open: (run: SimRun) => open.get(run.id)?.(),
  };
}

const QUEUED = `on:
  workflow_dispatch:
    inputs:
      group: { type: string }
      cancel: { type: string }
concurrency:
  group: g-\${{ inputs.group }}
  cancel-in-progress: \${{ inputs.cancel == 'true' }}
jobs:
  work:
    runs-on: ubuntu-latest
    steps:
      - run: gate
`;

test("a concurrency group runs one run and keeps one pending; a newer pending run replaces it", {
  skip,
}, async () => {
  const gate = gates();
  const { simulator, fake } = await setup({ ".github/workflows/main.yml": QUEUED }, gate.executor);
  const start = (group: string, cancel = "false") =>
    simulator.start({
      repository: "acme/app",
      workflow: ".github/workflows/main.yml",
      event: "workflow_dispatch",
      inputs: { group, cancel },
    });
  const a = await start("x");
  await gate.arrival(a.id);
  const b = await start("X");
  const other = await start("y");
  await gate.arrival(other.id);
  assert.equal(b.status, "pending", "the group's name ignores case");
  assert.equal(fake.world.run(b.id).status, "pending");
  assert.equal(fake.world.run(b.id).concurrency, "g-X");

  const c = await start("x");
  const replaced = await b.finished;
  assert.equal(replaced.conclusion, "cancelled");
  assert.deepEqual(replaced.jobs, []);
  assert.equal(fake.world.run(b.id).conclusion, "cancelled");
  assert.equal(c.status, "pending");
  assert.equal(a.status, "in_progress");

  gate.open(a);
  assert.equal((await a.finished).conclusion, "success");
  await gate.arrival(c.id);
  assert.equal(c.status, "in_progress");
  gate.open(c);
  gate.open(other);
  assert.equal((await c.finished).conclusion, "success");
  assert.equal((await other.finished).conclusion, "success");

  // cancel-in-progress cancels the running run, and the new one runs after it.
  const d = await start("z", "true");
  await gate.arrival(d.id);
  const e = await start("z", "true");
  const cancelled = await d.finished;
  assert.equal(cancelled.conclusion, "cancelled");
  assert.equal(cancelled.jobs[0]?.result, "cancelled");
  await gate.arrival(e.id);
  gate.open(e);
  assert.equal((await e.finished).conclusion, "success");
  await simulator.idle();
});

const CHAIN = `name: Chain
on:
  schedule:
    - cron: "0 9 * * *"
  workflow_dispatch:
    inputs:
      hop: { type: string }
concurrency:
  group: chain
  cancel-in-progress: false
jobs:
  hop:
    runs-on: ubuntu-latest
    steps:
      - run: hop \${{ inputs.hop }}
`;

test("the fake's dispatches start runs, which wait for the running one; schedules run on demand", {
  skip,
}, async () => {
  let fakeRef: Awaited<ReturnType<typeof setup>>["fake"] | undefined;
  let running = 0;
  let peak = 0;
  const executor = new RecordingExecutor(async (command) => {
    running++;
    peak = Math.max(peak, running);
    if (command.kind === "run" && fakeRef) {
      const hop = Number(command.script.replace("hop", "").trim() || "0");
      if (hop < 2) {
        const world = fakeRef.world;
        // As `gh workflow run` does, through the fake's dispatch.
        await world.dispatch(
          world.repository("acme/app"),
          { id: 1, path: ".github/workflows/main.yml", name: "Chain" },
          "main",
          { hop: String(hop + 1) },
          world.user("alice"),
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    running--;
    return undefined;
  });
  const { simulator, fake } = await setup({ ".github/workflows/main.yml": CHAIN }, executor);
  fakeRef = fake;
  const stop = simulator.listen();
  const [scheduled] = await simulator.schedule("acme/app");
  assert.ok(scheduled);
  await simulator.idle();
  stop();
  assert.equal(simulator.runs.length, 3);
  assert.deepEqual(
    simulator.runs.map((run) => [run.request.event, run.request.inputs?.hop ?? ""]),
    [
      ["schedule", ""],
      ["workflow_dispatch", "1"],
      ["workflow_dispatch", "2"],
    ],
  );
  // The dispatched runs are the ones the fake made.
  assert.deepEqual(
    simulator.runs.slice(1).map((run) => run.id),
    fake.dispatches.map((entry) => entry.runId),
  );
  assert.equal(peak, 1, "one run at a time in the group");
  for (const run of simulator.runs) assert.equal((await run.finished).conclusion, "success");
  assert.equal(executor.commands[1]?.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(executor.commands[1]?.env.GITHUB_ACTOR, "alice");
});

test("events start the workflows whose on: matches, and none for GITHUB_TOKEN's events", {
  skip,
}, async () => {
  const executor = new RecordingExecutor();
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on:
  issues:
    types: [labeled]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ github.event.label.name }}
`,
    },
    executor,
  );
  const event = (action: string, triggers = true) => ({
    name: "issues",
    repository: "acme/app",
    payload: { action, label: { name: "codeman" } },
    triggers,
  });
  assert.equal((await simulator.trigger(event("unlabeled"))).length, 0);
  assert.equal((await simulator.trigger(event("labeled", false))).length, 0);
  const [run] = await simulator.trigger(event("labeled"));
  assert.equal((await run?.finished)?.conclusion, "success");
  assert.equal(executor.commands[0]?.script, "echo codeman");
});
