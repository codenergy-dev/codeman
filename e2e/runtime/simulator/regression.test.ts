import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { RecordingExecutor } from "./executor.ts";
import { writeOutputs } from "./files.ts";
import { fixedWorkflows, type RunResult } from "./simulator.ts";
import { byName, setup } from "./testing.ts";

/**
 * The `always()` regression of the MVP plan: a run that only records answers skips `open-key`
 * and `agent`, and a job's implicit `success()` covers every job before it, so `next-run` was
 * skipped even though `apply` succeeded. `7ff267b` fixed it; the template before that commit
 * must skip `next-run`, and today's templates must run it.
 */
const FIX = "7ff267b";

function before(path: string): string | undefined {
  const shown = spawnSync("git", ["show", `${FIX}^:${path}`], { encoding: "utf8" });
  return shown.status === 0 ? shown.stdout : undefined;
}

const old = hasGit() ? before("templates/codeman.yml") : undefined;
const skip = !hasGit()
  ? "git is not on the PATH"
  : old === undefined
    ? `${FIX} is not in this clone`
    : false;

/** Codeman's bundle as a record-only run would answer: select picks task 1 to record, apply moves it. */
function recordOnly() {
  return new RecordingExecutor((command) => {
    if (command.kind !== "action") return undefined;
    const temp = command.env.RUNNER_TEMP ?? "";
    const step = command.inputs.step;
    if (step === "select") {
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
        "needs-agent": "false",
        task: "1",
        "base-sha": task["base-sha"],
        "task-budget": "2",
        "monthly-budget": "20",
        tasks: JSON.stringify([task]),
        dispatches: "[]",
      });
    }
    if (step === "apply") {
      mkdirSync(join(temp, "codeman", "chain"), { recursive: true });
      writeFileSync(join(temp, "codeman", "chain", "1"), "");
      writeOutputs(command.env, { chain: "true", continues: "false" });
    }
    return undefined;
  });
}

async function answer(
  files: Record<string, string>,
): Promise<{ result: RunResult; executor: RecordingExecutor }> {
  const executor = recordOnly();
  const { simulator, fake } = await setup(files, executor);
  const [run, ...others] = await simulator.trigger({
    name: "issue_comment",
    repository: "acme/app",
    payload: {
      action: "created",
      issue: { number: 1, labels: [{ name: "codeman" }] },
      comment: { body: "/codeman decide 1a", user: { login: "alice", type: "User" } },
      sender: { login: "alice", type: "User" },
    },
    workflows: fixedWorkflows(files),
  });
  assert.ok(run);
  assert.equal(others.length, 0, "codeman-task.yml runs only when called");
  const result = await run.finished;
  assert.deepEqual(fake.violations, []);
  return { result, executor };
}

test("with the template before the fix, next-run is skipped after a record-only run", {
  skip,
}, async () => {
  const { result } = await answer({ ".github/workflows/codeman.yml": old ?? "" });
  const select = result.jobs.find((job) => job.id === "select");
  assert.equal(select?.result, "success", select?.log);
  assert.equal(result.graph["open-key"]?.result, "skipped");
  assert.equal(result.graph.agent?.result, "skipped");
  assert.equal(
    result.graph.apply?.result,
    "success",
    result.jobs.find((job) => job.id === "apply")?.log,
  );
  assert.equal(result.graph.apply?.outputs.chain, "true");
  assert.equal(result.graph["next-run"]?.result, "skipped");
});

test("with today's templates, next-run runs after a record-only run", { skip }, async () => {
  const { result, executor } = await answer({
    ".github/workflows/codeman.yml": readFileSync("templates/codeman.yml", "utf8"),
    ".github/workflows/codeman-task.yml": readFileSync("templates/codeman-task.yml", "utf8"),
  });
  const jobs = byName(result);
  const select = result.jobs.find((job) => job.id === "select");
  assert.equal(select?.result, "success", select?.log);
  for (const job of ["Open key", "Agent ()", "Close key", "Release pod"]) {
    assert.equal(jobs[`#1 / ${job}`]?.result, "skipped", job);
  }
  assert.equal(jobs["#1 / Apply"]?.result, "success", jobs["#1 / Apply"]?.log);
  assert.equal(result.graph.task?.result, "success");
  assert.equal(result.graph.dispatch?.result, "skipped");
  assert.equal(result.graph["next-run"]?.result, "success");
  assert.match(executor.of("Next run")[0]?.script ?? "", /gh workflow run "\$WORKFLOW"/);
  assert.equal(result.conclusion, "success");
  // apply's token has no permission, and only select's job got an OIDC request token.
  assert.deepEqual(jobs["#1 / Apply"]?.permissions, {});
  assert.ok(select?.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  assert.equal(jobs["#1 / Apply"]?.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
});
