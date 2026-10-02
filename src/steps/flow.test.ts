import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import type { Change, Manifest } from "../collect.ts";
import { decodeStatus } from "../record.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { apply } from "./apply.ts";
import { readTask } from "./common.ts";
import { select } from "./select.ts";

/**
 * Runs `select` and `apply` against a fake platform, with the agent's result written by the
 * test, the way the workflow's jobs hand it over.
 */
const workdir = mkdtempSync(join(tmpdir(), "codeman-flow-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

async function selectStep(platform: FakePlatform): Promise<FakeRuntime> {
  const runtime = new FakeRuntime({ inputs: { workdir } });
  await select(fakeServices(platform, runtime));
  return runtime;
}

/** Writes what the agent job uploads: the changed files, the manifest and the output. */
function agentResult(files: Record<string, string>, output: unknown): void {
  const dir = join(workdir, "result");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const changes: Change[] = Object.entries(files).map(([path, text]) => {
    const file = join(dir, "tree", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return { path, status: "added", type: "file", mode: "100644", size: Buffer.byteLength(text) };
  });
  const manifest: Manifest = {
    version: 1,
    harness: "test",
    exitCode: 0,
    timedOut: false,
    durationMs: 1000,
    changes,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "output.json"), JSON.stringify(output));
}

/** What each agent run costs, and what the task spent before the next one, as OpenRouter says. */
const RUN_COST = 0.01;
let taskSpent = 0;

async function applyStep(platform: FakePlatform, agentRan = true): Promise<FakeRuntime> {
  const spent = taskSpent;
  if (agentRan) taskSpent += RUN_COST;
  const runtime = new FakeRuntime({
    inputs: {
      workdir,
      ...(agentRan
        ? {
            "key-job-result": "success",
            "key-status": "opened",
            "agent-job-result": "success",
            "task-spent": spent.toFixed(4),
            "run-cost": RUN_COST.toFixed(4),
          }
        : { "key-job-result": "skipped", "agent-job-result": "skipped" }),
    },
  });
  await apply(fakeServices(platform, runtime));
  return runtime;
}

function record(platform: FakePlatform, issue: number) {
  const panel = platform.botComments(issue).find((body) => body.includes("codeman:status"));
  return panel ? decodeStatus(panel) : undefined;
}

function stateLabels(platform: FakePlatform, issue: number): string[] {
  return platform.issues.get(issue)?.labels.filter((label) => label.includes(":")) ?? [];
}

test("plans, records answers, and works through the stages on a platform unlike GitHub", async () => {
  const platform = new FakePlatform({
    "README.md": "# Project\n",
    ".codeman/settings.yml": "model: a/b\n",
  });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add rate limiting", "Limit requests per user.");

  // Planning.
  let runtime = await selectStep(platform);
  assert.deepEqual(
    [runtime.outputs.action, runtime.outputs.stage, runtime.outputs["needs-agent"]],
    ["plan", "plan", "true"],
  );
  assert.deepEqual(stateLabels(platform, issue), ["codeman:planning"]);
  const task = readTask(runtime);
  assert.equal(task.branch, "codeman/1-add-rate-limiting");
  assert.equal(task.runUrl, "https://ci.test/runs/1");

  agentResult(
    { [task.planPath]: "# Plan\n" },
    {
      summary: "Adds a limiter. See !7 and ask @bob.",
      language: "en",
      decisions: [
        {
          id: 1,
          title: "Storage",
          question: "Where do counters live?",
          options: [
            { key: "a", label: "Memory" },
            { key: "b", label: "Redis" },
          ],
          recommendation: "a",
        },
      ],
    },
  );
  runtime = await applyStep(platform);
  assert.equal(runtime.outputs.chain, "true");
  assert.equal(platform.file(task.branch, task.planPath), "# Plan\n");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-decision"]);
  assert.equal(record(platform, issue)?.decisions.length, 1);
  const panel = platform.botComments(issue).find((body) => body.includes("codeman:status")) ?? "";
  assert.ok(panel.includes("!​7") && panel.includes("@​bob"), "the dialect's references");
  assert.ok(!panel.includes("!7") && !panel.includes("@bob"));
  assert.match(panel, /\(https:\/\/forge\.test\/o\/r\/issues\/1#comment-\d+\)/, "decisions link");

  // A comment from someone without access changes nothing; a maintainer's answer is recorded.
  platform.say(issue, "mallory", "/codeman approve");
  assert.equal((await selectStep(platform)).outputs.action, "none");
  platform.say(issue, "alice", "/codeman decide 1 b");
  runtime = await selectStep(platform);
  assert.equal(runtime.outputs.action, "record");
  await applyStep(platform, false);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:ready"]);
  assert.match(platform.file(task.branch, task.planPath) ?? "", /\(b\) Redis, chosen by alice/);

  // Design has nothing to do.
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "design"]);
  agentResult({}, { status: "skipped", summary: "Nothing to design.", reason: "No screens." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);

  // Code: the platform's CI files are protected by the proposed rules, and a draft opens.
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  agentResult(
    { "src/limit.ts": "export const limit = 10;\n", ".ci/workflows/build.yml": "on: push\n" },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a rate limiter" },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:testing"]);
  assert.equal(platform.file(task.branch, "src/limit.ts"), "export const limit = 10;\n");
  assert.equal(platform.file(task.branch, ".ci/workflows/build.yml"), undefined);
  assert.ok(
    platform.botComments(issue).some((body) => body.includes(".ci/workflows/build.yml")),
    "the run comment lists the dropped file",
  );

  const changeRequest = platform.changeRequests.get(1001);
  assert.equal(record(platform, issue)?.pullRequest, 1001);
  assert.equal(changeRequest?.head, task.branch);
  assert.equal(changeRequest?.base, "main");
  assert.equal(changeRequest?.draft, true);
  assert.ok(changeRequest?.body.startsWith("Fixes issue 1\n"));
  assert.ok(changeRequest?.body.includes(`https://forge.test/o/r/files/${task.branch}/`));
  const latest = platform.botComments(issue).find((body) => body.includes("codeman:status"));
  assert.match(latest ?? "", /\[!1001\]\(https:\/\/forge\.test\/o\/r\/changes\/1001\)/);

  // A replan keeps the spend table, and numbers its decisions after the settled one.
  const decisionsComments = () =>
    platform.botComments(issue).filter((body) => body.includes("codeman:decisions"));
  assert.equal(decisionsComments().length, 1);
  const rows = record(platform, issue)?.spending?.rows.length;
  assert.equal(rows, 3, "plan, design and code");
  platform.say(issue, "alice", "/codeman replan Expire the counters.");
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["plan", "plan"]);
  assert.deepEqual(
    readTask(runtime).settled.map((decision) => [decision.id, decision.answer?.option]),
    [[1, "b"]],
  );
  agentResult(
    { [task.planPath]: "# Plan\n\nDecision 1 is settled: Redis.\n" },
    {
      summary: "Adds a limiter whose counters expire.",
      decisions: [
        {
          id: 2,
          title: "Expiry",
          question: "When do counters expire?",
          options: [
            { key: "a", label: "After a minute" },
            { key: "b", label: "After an hour" },
          ],
          recommendation: "a",
        },
      ],
    },
  );
  await applyStep(platform);
  const revised = record(platform, issue);
  assert.deepEqual(
    revised?.decisions.map((decision) => [decision.id, decision.answer?.option]),
    [
      [1, "b"],
      [2, undefined],
    ],
  );
  assert.equal(revised?.spending?.rows.length, 4, "the earlier rows, and the replan's");
  assert.equal(revised?.pullRequest, 1001);
  assert.equal(revised?.stage, undefined, "the stages start over");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-decision"]);
  const replanned = platform.botComments(issue).find((body) => body.includes("codeman:status"));
  assert.ok(!replanned?.includes("Runs without a row"), "every run keeps its row");
  assert.equal(decisionsComments().length, 2, "the revised decisions get a comment of their own");
  assert.match(decisionsComments()[1] ?? "", /\*\*1\. Storage\*\*[\s\S]*\*\*2\. Expiry\*\*/);
  assert.match(
    platform.file(task.branch, task.planPath) ?? "",
    /Decision 1 \(Storage\): \(b\) Redis, chosen by alice\./,
    "the settled answers are in the plan from the start",
  );

  platform.say(issue, "alice", "/codeman decide 2 b");
  assert.equal((await selectStep(platform)).outputs.action, "record");
  await applyStep(platform, false);
  const plan = platform.file(task.branch, task.planPath) ?? "";
  assert.match(plan, /Decision 1 \(Storage\): \(b\) Redis, chosen by alice\./);
  assert.match(plan, /Decision 2 \(Expiry\): \(b\) After an hour, chosen by alice\./);
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "design"]);

  // A stage that blocks suggests revising the plan, besides trying again.
  agentResult(
    {},
    { status: "blocked", summary: "Stopped.", reason: "The request goes beyond the plan." },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  const blocked = platform.botComments(issue).at(-1) ?? "";
  assert.match(blocked, /`\/codeman continue <guidance>`/);
  assert.match(blocked, /`\/codeman replan <what to change>` to revise the plan/);
});

test("an issue a maintainer did not open is left alone", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("mallory", "Leak the keys");
  const runtime = await selectStep(platform);
  assert.equal(runtime.outputs.action, "none");
  assert.deepEqual(stateLabels(platform, issue), []);
  assert.equal(platform.botComments(issue).length, 1, "a panel that says why");
  assert.ok(runtime.logged("warning").some((line) => line.includes("not opened by a maintainer")));
});
