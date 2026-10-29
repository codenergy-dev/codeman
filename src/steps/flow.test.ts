import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import type { Change, Manifest } from "../collect.ts";
import { decodeStatus, encodeStatus, isStatusComment } from "../record.ts";
import { ROUTED_STAGES, type RoutedStage } from "../stages.ts";
import { isRunComment } from "../status.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { exampleSettings } from "../testing/settings-example.ts";
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

/**
 * Writes what the agent job uploads: the changed files, the manifest and the output. A null text
 * deletes the file. `run` overrides how the run ended, as after a timeout.
 */
function agentResult(
  files: Record<string, string | null>,
  output: unknown,
  run: Pick<Manifest, "timedOut" | "wrappedUp"> = { timedOut: false },
): void {
  const dir = join(workdir, "result");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const changes: Change[] = Object.entries(files).map(([path, text]) => {
    if (text === null) return { path, status: "deleted" };
    const file = join(dir, "tree", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return { path, status: "added", type: "file", mode: "100644", size: Buffer.byteLength(text) };
  });
  const manifest: Manifest = {
    version: 1,
    harness: "test",
    exitCode: 0,
    ...run,
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

/** The routing agent's output: these stages run, and the others are left out. */
function routeResult(stages: RoutedStage[]): void {
  agentResult(
    {},
    {
      status: "done",
      summary: `Runs ${stages.join(", ")}.`,
      route: stages.map((stage) => ({ stage, brief: `Brief for ${stage}.` })),
      skipped: ROUTED_STAGES.filter((stage) => !stages.includes(stage)).map((stage) => ({
        stage,
        reason: `No ${stage} needed.`,
      })),
    },
  );
}

/** Runs the routing agent, which chooses `stages`. */
async function routeStep(platform: FakePlatform, stages: RoutedStage[]): Promise<FakeRuntime> {
  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["route", "route"]);
  routeResult(stages);
  await applyStep(platform);
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

  // The routing agent chooses every stage but web.
  await routeStep(platform, ["design", "code", "test", "review"]);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:designing"]);

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
  const rows = record(platform, issue)?.spending?.rows;
  assert.equal(rows?.length, 4, "plan, route, design and code");
  assert.ok(rows?.every((row) => row.provider === "openrouter"));
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
  assert.equal(revised?.spending?.rows.length, 5, "the earlier rows, and the replan's");
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
  await routeStep(platform, ["design", "code", "review"]);
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

/** A task planned without decisions, ready for the routing agent. */
async function plannedTask(platform: FakePlatform): Promise<{ issue: number; branch: string }> {
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a limiter", "Limit requests.");
  const runtime = await selectStep(platform);
  const { branch, planPath } = readTask(runtime);
  agentResult({ [planPath]: "# Plan\n" }, { summary: "Adds a limiter.", decisions: [] });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:ready"]);
  return { issue, branch };
}

test("the routing agent chooses the stages, and review has the last word", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue, branch } = await plannedTask(platform);

  // A plan without decisions goes to the router too; it leaves out web, design and test.
  let runtime = await routeStep(platform, ["code", "review"]);
  assert.deepEqual(readTask(runtime).route, { trigger: "decisions", fallback: "design" });
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);
  const routed = platform.botComments(issue).at(-1) ?? "";
  assert.match(routed, /### Codeman · Next stages chosen/);
  assert.match(routed, /chose these stages, in order: code, review\./);
  assert.match(routed, /\*\*design\*\*: No design needed\./);

  // Each stage hands over to the next stage of the route.
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  agentResult(
    { "src/limit.ts": "export const limit = 10;\n" },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a limiter" },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:reviewing"]);
  assert.equal(platform.changeRequests.get(1001)?.draft, true);

  // Review ends the route and the task.
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "review"]);
  agentResult({}, { status: "done", summary: "Looks right." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:done"]);
  assert.equal(platform.changeRequests.get(1001)?.draft, false);
  assert.equal(platform.file(branch, ".codemanignore")?.includes("AGENTS.md"), true);
  assert.equal(platform.changeRequestComments.get(1001)?.length, 1, "review's report");
  assert.equal(record(platform, issue)?.route, undefined);

  // A fix goes to the router, and the stages it chooses read the request.
  platform.say(issue, "alice", "/codeman fix Rename the limiter.");
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["route", "route"]);
  assert.deepEqual(readTask(runtime).route, { trigger: "fix", fallback: "code" });
  routeResult(["code", "review"]);
  await applyStep(platform);
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  assert.deepEqual(
    readTask(runtime).requests.map((request) => [request.kind, request.text]),
    [["fix", "Rename the limiter."]],
  );
  agentResult(
    { "src/limit.ts": "export const rateLimit = 10;\n" },
    { status: "done", summary: "Renamed it.", commitMessage: "Rename the limiter" },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:reviewing"]);

  // Review asks for changes: the router chooses again.
  runtime = await selectStep(platform);
  assert.deepEqual(
    readTask(runtime).requests.map((request) => request.text),
    ["Rename the limiter."],
    "review checks the fix too",
  );
  agentResult({}, { status: "changes", summary: "Report.", reason: "Name the unit." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:routing"]);
  runtime = await selectStep(platform);
  assert.deepEqual(readTask(runtime).route, { trigger: "changes", fallback: "code" });

  // A route without review cannot be used: the stages run in their fixed order.
  routeResult(["code"]);
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);
  const fallback = platform.botComments(issue).at(-1) ?? "";
  assert.match(fallback, /route must end with review/);
  assert.match(
    fallback,
    /could not use the routing agent's result, so the stages run in their fixed order: code, test, review\./,
  );
  assert.deepEqual(
    record(platform, issue)?.route?.stages.map((step) => step.stage),
    ["code", "test", "review"],
  );
});

test("a route of review alone lets review decide that nothing was needed", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  await routeStep(platform, ["review"]);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:reviewing"]);

  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "review"]);
  agentResult(
    {},
    { status: "blocked", summary: "Nothing to merge.", reason: "The limiter already exists." },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.equal(platform.changeRequests.size, 0, "no pull request with the plan alone");
  assert.match(platform.botComments(issue).at(-1) ?? "", /The limiter already exists\./);
});

test("a task the router blocked before review always ran routes again on continue", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  const panel = platform.comments.get(issue)?.find((comment) => isStatusComment(comment.body));
  const before = record(platform, issue);
  assert.ok(panel && before);
  panel.body = panel.body.replace(
    /<!-- codeman:status [A-Za-z0-9_-]* -->/,
    encodeStatus({ ...before, route: { stages: [], skipped: [] } }),
  );
  await platform.setState(issue, [], "blocked");

  platform.say(issue, "alice", "/codeman continue Check again.");
  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["route", "route"]);
  assert.deepEqual(readTask(runtime).route, { trigger: "continue", fallback: "design" });
  assert.deepEqual(stateLabels(platform, issue), ["codeman:routing"]);
});

test("a fix posted while decisions are pending is reported in the run comment", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a limiter", "Limit requests.");
  const { planPath } = readTask(await selectStep(platform));
  agentResult(
    { [planPath]: "# Plan\n" },
    {
      summary: "Adds a limiter.",
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
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-decision"]);

  platform.say(issue, "alice", "/codeman fix Rename it.");
  assert.equal((await selectStep(platform)).outputs.action, "record");
  await applyStep(platform, false);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-decision"]);
  assert.match(
    platform.botComments(issue).at(-1) ?? "",
    /`fix` counts only once every decision is answered, so it was not applied\./,
  );

  platform.say(issue, "alice", "/codeman approve");
  assert.equal((await selectStep(platform)).outputs.action, "record");
  await applyStep(platform, false);
  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["route", "route"]);
  assert.deepEqual(readTask(runtime).route, { trigger: "decisions", fallback: "design" });
  assert.deepEqual(readTask(runtime).requests, []);
});

test("a review while decisions are pending waits for them, and then counts", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  await routeStep(platform, ["code", "review"]);
  await selectStep(platform);
  agentResult(
    { "src/limit.ts": "export const limit = 10;\n" },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a limiter" },
  );
  await applyStep(platform);
  await selectStep(platform);
  agentResult(
    {},
    {
      status: "decisions",
      summary: "Report.",
      decisions: [
        {
          id: 1,
          title: "Unit",
          question: "Per second or per minute?",
          options: [
            { key: "a", label: "Second" },
            { key: "b", label: "Minute" },
          ],
          recommendation: "b",
        },
      ],
    },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-decision"]);
  assert.equal(record(platform, issue)?.pullRequest, 1001);

  // The review starts no run while the decisions are pending.
  const reviewId = platform.review(1001, "alice", "changes-requested", "Name the unit.");
  const comments = platform.botComments(issue);
  assert.equal((await selectStep(platform)).outputs.action, "none");
  assert.deepEqual(platform.botComments(issue), comments);

  platform.say(issue, "alice", "/codeman approve");
  assert.equal((await selectStep(platform)).outputs.action, "record");
  await applyStep(platform, false);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:ready"]);

  // Once they are answered, the review's request counts.
  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["route", "route"]);
  assert.equal(readTask(runtime).route?.trigger, "fix");
  assert.deepEqual(
    readTask(runtime).reviews.map((review) => [review.id, review.body]),
    [[reviewId, "Name the unit."]],
  );
  routeResult(["code", "review"]);
  await applyStep(platform);
  assert.equal(record(platform, issue)?.processedReviewId, reviewId);
});

test("a review with commands in codeman:ready does not stop the task from routing", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  const panel = platform.comments.get(issue)?.find((comment) => isStatusComment(comment.body));
  const before = record(platform, issue);
  assert.ok(panel && before);
  panel.body = panel.body.replace(
    /<!-- codeman:status [A-Za-z0-9_-]* -->/,
    encodeStatus({ ...before, pullRequest: 1001 }),
  );
  platform.review(1001, "alice", "commented", "/codeman approve\n/codeman set max-runs 5");

  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["route", "route"]);
});

test("after a timeout, a wrap-up's output is out of time whatever it reports, unless blocked", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  await routeStep(platform, ["code", "review"]);
  const wrappedUp = { timedOut: true, wrappedUp: true };

  // The wrap-up reports done: the work is committed, and the code stage runs again.
  await selectStep(platform);
  agentResult(
    { "src/limit.ts": "export const limit = 10;\n" },
    {
      status: "done",
      summary: "The limiter is in; its tests are left.",
      commitMessage: "Add a limiter",
    },
    wrappedUp,
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);
  const comment = platform.botComments(issue).at(-1) ?? "";
  assert.match(comment, /A wrap-up left its work consistent, and it is committed\./);
  assert.match(comment, /The limiter is in; its tests are left\./);
  const branch = record(platform, issue)?.branch ?? "";
  assert.equal(platform.commits.get(platform.branches.get(branch) ?? "")?.message, "Add a limiter");

  // The wrap-up finds the plan cannot be carried out: the task is blocked, as for any stage.
  await selectStep(platform);
  agentResult(
    {},
    { status: "blocked", summary: "Half done.", reason: "The plan's API does not exist." },
    wrappedUp,
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.match(platform.botComments(issue).at(-1) ?? "", /The plan's API does not exist\./);
});

test("max-runs blocks a stage at its max-runs-th unfinished run, and review at its max-runs-th round", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\nmax-runs: 2\n" });
  const { issue } = await plannedTask(platform);
  await routeStep(platform, ["code", "review"]);

  // The code stage runs twice without finishing: the second run blocks the task.
  let runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  agentResult({}, { status: "partial", summary: "Half of the limiter." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  agentResult({}, { status: "partial", summary: "Still half of the limiter." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.match(
    platform.botComments(issue).at(-1) ?? "",
    /has run 2 times in a row without finishing \(`max-runs` is 2\)/,
  );

  // After a continue, review's first changes sends the work back.
  platform.say(issue, "alice", "/codeman continue Go on.");
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  agentResult(
    { "src/limit.ts": "export const limit = 10;\n" },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a limiter" },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:reviewing"]);
  await selectStep(platform);
  agentResult({}, { status: "changes", summary: "Report.", reason: "Name the unit." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:routing"]);
  assert.equal(record(platform, issue)?.reviewRounds, 1);

  // Its second changes in a row blocks the task.
  await routeStep(platform, ["review"]);
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "review"]);
  agentResult({}, { status: "changes", summary: "Report.", reason: "Name the unit." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.equal(record(platform, issue)?.reviewRounds, 2);
  assert.match(
    platform.botComments(issue).at(-1) ?? "",
    /Review asked for changes 2 times in a row \(`max-runs` is 2\)/,
  );
});

test("continue after review blocks for its rounds gives review a fresh count", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\nmax-runs: 3\n" });
  const { issue } = await plannedTask(platform);
  await routeStep(platform, ["review"]);
  const panel = platform.comments.get(issue)?.find((comment) => isStatusComment(comment.body));
  const before = record(platform, issue);
  assert.ok(panel && before);
  panel.body = panel.body.replace(
    /<!-- codeman:status [A-Za-z0-9_-]* -->/,
    encodeStatus({ ...before, reviewRounds: 2 }),
  );

  let runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "review"]);
  agentResult({}, { status: "changes", summary: "Report.", reason: "Name the unit." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.match(platform.botComments(issue).at(-1) ?? "", /to allow 3 more rounds\./);

  platform.say(issue, "alice", "/codeman continue Go on.");
  runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "review"]);
  agentResult({}, { status: "changes", summary: "Report.", reason: "Name the unit." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:routing"]);
  assert.equal(record(platform, issue)?.reviewRounds, 1);
});

test("the web stage commits only valid pages under docs/web/, and the panel lists old ones", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue, branch } = await plannedTask(platform);
  await routeStep(platform, ["web", "code", "review"]);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:researching"]);

  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "web"]);
  const dates = "created_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z";
  agentResult(
    {
      "docs/web/tools/fetch-markdown.md": `---\ntitle: Fetch Markdown\n${dates}\n---\n\n# Fetch Markdown\n`,
      "docs/web/acme/acme-api.md": `---\ntitle: Acme API\nurl: https://acme.test/api\n${dates}\ntool: docs/web/tools/fetch-markdown.md\n---\n\nFacts.\n`,
      "docs/web/acme/broken.md": "No front matter.\n",
      "src/limit.ts": "export const limit = 10;\n",
    },
    { status: "done", summary: "Recorded the Acme API.", commitMessage: "Record the Acme API" },
  );
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);
  assert.ok(platform.file(branch, "docs/web/acme/acme-api.md")?.includes("Facts."));
  assert.ok(platform.file(branch, "docs/web/tools/fetch-markdown.md"));
  assert.equal(platform.file(branch, "docs/web/acme/broken.md"), undefined);
  assert.equal(platform.file(branch, "src/limit.ts"), undefined);
  const comment = platform.botComments(issue).at(-1) ?? "";
  assert.match(comment, /docs\/web\/acme\/broken\.md: it has no front matter/);
  assert.match(comment, /src\/limit\.ts: the web stage changes only docs\/web\//);

  const pages = record(platform, issue)?.webPages;
  assert.deepEqual(Object.keys(pages ?? {}), ["docs/web/acme/acme-api.md"], "tools are not pages");
  const panel = platform.botComments(issue).find((body) => body.includes("codeman:status")) ?? "";
  assert.match(panel, /#### Third-party documentation to refresh/);
  assert.match(panel, /- docs\/web\/acme\/acme-api\.md: \d+ days/);

  // Other stages read docs/web/ as data, and cannot change it.
  await selectStep(platform);
  agentResult(
    { "docs/web/acme/acme-api.md": "Changed.\n", "src/limit.ts": "export const limit = 10;\n" },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a limiter" },
  );
  await applyStep(platform);
  assert.ok(platform.file(branch, "docs/web/acme/acme-api.md")?.includes("Facts."));
  assert.equal(platform.file(branch, "src/limit.ts"), "export const limit = 10;\n");
  assert.match(
    platform.botComments(issue).at(-1) ?? "",
    /docs\/web\/acme\/acme-api\.md: only the web stage changes docs\/web\//,
  );
});

/** A maintainer's commit on `branch`, pushed outside Codeman. */
async function push(
  platform: FakePlatform,
  branch: string,
  files: Record<string, string>,
): Promise<string> {
  // The prototype's, so a test that wraps the platform's `commit` can push from inside it.
  return FakePlatform.prototype.commit.call(platform, {
    branch,
    baseSha: platform.branches.get(branch) ?? "",
    createBranch: false,
    changes: Object.entries(files).map(([path, text]) => ({ path, content: Buffer.from(text) })),
    message: "A maintainer's commit",
  });
}

/**
 * A task in the code stage, on a repository whose `.codemanignore` lets the agent write CI files,
 * which apply stages; `src/old.ts` is on its branch. Returns the code run's select.
 */
async function codingTask(): Promise<{
  platform: FakePlatform;
  issue: number;
  branch: string;
}> {
  const platform = new FakePlatform({
    ".codeman/settings.yml": "model: a/b\n",
    ".codemanignore": "AGENTS.md\n",
    "src/old.ts": "export const old = 1;\n",
  });
  const { issue, branch } = await plannedTask(platform);
  await routeStep(platform, ["code", "review"]);
  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "code"]);
  return { platform, issue, branch };
}

/** The code stage's result: a new file, a deletion and a CI file. */
function codeResult(): void {
  agentResult(
    {
      "src/limit.ts": "export const limit = 10;\n",
      "src/old.ts": null,
      ".ci/workflows/build.yml": "on: push\n",
    },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a limiter" },
  );
}

test("a branch moved during the run on other paths gets the agent's changes on its new head", async () => {
  const { platform, issue, branch } = await codingTask();
  const theirs = await push(platform, branch, { "src/mine.ts": "export const mine = 1;\n" });
  codeResult();
  const runtime = await applyStep(platform);

  assert.deepEqual(stateLabels(platform, issue), ["codeman:reviewing"]);
  assert.equal(runtime.outputs.chain, "true");
  const head = platform.commits.get(platform.branches.get(branch) ?? "");
  assert.equal(head?.parent, theirs, "a new commit on the maintainer's");
  assert.equal(head?.message, "Add a limiter");
  assert.equal(platform.file(branch, "src/mine.ts"), "export const mine = 1;\n");
  assert.equal(platform.file(branch, "src/limit.ts"), "export const limit = 10;\n");
  assert.equal(platform.file(branch, "src/old.ts"), undefined, "the deletion");
  assert.equal(platform.file(branch, ".codeman/workflows/build.yml"), "on: push\n", "staged");
  assert.match(platform.botComments(issue).at(-1) ?? "", /### Codeman · Code stage: done/);
});

test("a branch moved during the run on the agent's paths blocks the task, and names them", async () => {
  const { platform, issue, branch } = await codingTask();
  const theirs = await push(platform, branch, {
    "src/limit.ts": "export const limit = 5;\n",
    "src/old.ts": "export const old = 2;\n",
    // The workflow the agent staged, where the accept would move it.
    ".ci/workflows/build.yml": "on: pull_request\n",
    "NOTES.md": "Notes.\n",
  });
  codeResult();
  const runtime = await applyStep(platform);

  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.equal(platform.branches.get(branch), theirs, "the maintainer's commit is kept");
  assert.equal(platform.file(branch, "src/limit.ts"), "export const limit = 5;\n");
  assert.equal(platform.file(branch, ".codeman/workflows/build.yml"), undefined);
  const comment = platform.botComments(issue).at(-1) ?? "";
  assert.match(comment, /### Codeman · Code stage: blocked/);
  assert.match(comment, /The task branch moved during the run/);
  assert.match(
    comment,
    /The new commits change paths this run changed too: \.ci\/workflows\/build\.yml, src\/limit\.ts, src\/old\.ts\./,
  );
  assert.ok(!comment.includes("NOTES.md"), "only the paths in conflict");
  assert.match(comment, /Comment `\/codeman continue <guidance>` to try again\./);
  assert.equal(runtime.outputs.continues, "false");

  // Continue runs the stage again, from the maintainer's commit.
  platform.say(issue, "alice", "/codeman continue Keep their limit.");
  const again = await selectStep(platform);
  assert.deepEqual([again.outputs.action, again.outputs.stage], ["implement", "code"]);
  assert.equal(readTask(again).baseSha, theirs);
});

test("a branch that moves again while apply commits on its new head blocks the task", async () => {
  const { platform, issue, branch } = await codingTask();
  // Each of Codeman's commits finds a new maintainer's commit on the branch.
  let pushes = 0;
  platform.commit = async (options) => {
    pushes += 1;
    await push(platform, branch, { [`src/mine-${pushes}.ts`]: "export const mine = 1;\n" });
    return FakePlatform.prototype.commit.call(platform, options);
  };
  codeResult();
  await applyStep(platform);

  assert.equal(pushes, 2, "one retry");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  assert.equal(platform.file(branch, "src/limit.ts"), undefined);
  assert.equal(platform.file(branch, "src/mine-2.ts"), "export const mine = 1;\n");
  const comment = platform.botComments(issue).at(-1) ?? "";
  assert.match(comment, /### Codeman · Code stage: blocked/);
  assert.match(comment, /The task branch moved again while Codeman committed this run's changes/);
});

/** A task whose review passed with a CI file staged, which waits for the accept. */
async function stagedTask(): Promise<{ platform: FakePlatform; issue: number; branch: string }> {
  const { platform, issue, branch } = await codingTask();
  codeResult();
  await applyStep(platform);
  const runtime = await selectStep(platform);
  assert.deepEqual([runtime.outputs.action, runtime.outputs.stage], ["implement", "review"]);
  agentResult({}, { status: "done", summary: "The CI file is safe." });
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-workflow"]);
  return { platform, issue, branch };
}

/** The run that handles a maintainer's accept-workflows, which is already posted. */
async function acceptStep(platform: FakePlatform, issue: number): Promise<string> {
  const runtime = await selectStep(platform);
  assert.equal(runtime.outputs.action, "accept");
  await applyStep(platform, false);
  return platform.botComments(issue).at(-1) ?? "";
}

test("accept-workflows moves the staged files whose blobs are the ones review listed", async () => {
  const { platform, issue, branch } = await stagedTask();
  const listed = platform.commits.get(platform.branches.get(branch) ?? "")?.files;
  assert.deepEqual(record(platform, issue)?.staged, {
    ".codeman/workflows/build.yml": listed?.get(".codeman/workflows/build.yml")?.sha,
  });

  platform.say(issue, "alice", "/codeman accept-workflows");
  const comment = await acceptStep(platform, issue);
  assert.match(comment, /alice accepted \.ci\/workflows\/build\.yml/);
  assert.equal(platform.file(branch, ".ci/workflows/build.yml"), "on: push\n");
  assert.equal(platform.file(branch, ".codeman/workflows/build.yml"), undefined);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:done"]);
  assert.deepEqual(record(platform, issue)?.staged, {}, "nothing left staged");
});

test("accept-workflows refuses a staged file changed after the accept, even by a backdated commit", async () => {
  const { platform, issue, branch } = await stagedTask();
  platform.say(issue, "alice", "/codeman accept-workflows");
  const theirs = await push(platform, branch, {
    ".codeman/workflows/build.yml": "on: pull_request\n",
    ".codeman/workflows/extra.yml": "on: push\n",
  });
  // Dated before the comment, as whoever makes a commit may date it.
  const commit = platform.commits.get(theirs);
  assert.ok(commit);
  commit.time = "2026-10-01T00:00:00.000Z";

  const comment = await acceptStep(platform, issue);
  assert.match(comment, /The staged workflows changed after they were accepted\./);
  assert.match(
    comment,
    /Changed since Codeman listed them: \.ci\/workflows\/build\.yml, \.ci\/workflows\/extra\.yml\./,
  );
  assert.equal(platform.branches.get(branch), theirs, "nothing moved");
  assert.equal(platform.file(branch, ".ci/workflows/build.yml"), undefined);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-workflow"]);

  // The refusal listed them as they are now: read again, they move.
  platform.say(issue, "alice", "/codeman accept-workflows");
  await acceptStep(platform, issue);
  assert.equal(platform.file(branch, ".ci/workflows/build.yml"), "on: pull_request\n");
  assert.equal(platform.file(branch, ".ci/workflows/extra.yml"), "on: push\n");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:done"]);
});

test("accept-workflows moves the listed content, whichever commit holds it and whenever it is dated", async () => {
  const { platform, issue, branch } = await stagedTask();
  // Changed before the comment, and changed back after it.
  await push(platform, branch, { ".codeman/workflows/build.yml": "on: pull_request\n" });
  platform.say(issue, "alice", "/codeman accept-workflows");
  await push(platform, branch, { ".codeman/workflows/build.yml": "on: push\n" });

  const comment = await acceptStep(platform, issue);
  assert.match(comment, /alice accepted \.ci\/workflows\/build\.yml/);
  assert.equal(platform.file(branch, ".ci/workflows/build.yml"), "on: push\n");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:done"]);
});

test("accept-workflows refuses with a record from before the listed blobs, then moves them", async () => {
  const { platform, issue, branch } = await stagedTask();
  const panel = platform.comments.get(issue)?.find((comment) => isStatusComment(comment.body));
  const before = record(platform, issue);
  assert.ok(panel && before);
  const { staged: _, ...older } = before;
  panel.body = panel.body.replace(/<!-- codeman:status [A-Za-z0-9_-]* -->/, encodeStatus(older));

  platform.say(issue, "alice", "/codeman accept-workflows");
  const comment = await acceptStep(platform, issue);
  assert.match(comment, /Codeman has no record of the staged workflows it listed/);
  assert.equal(platform.file(branch, ".ci/workflows/build.yml"), undefined);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-workflow"]);
  assert.ok(record(platform, issue)?.staged?.[".codeman/workflows/build.yml"], "listed now");

  platform.say(issue, "alice", "/codeman accept-workflows");
  await acceptStep(platform, issue);
  assert.equal(platform.file(branch, ".ci/workflows/build.yml"), "on: push\n");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:done"]);
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

test("select gives each task its agent's times, and its agent job's timeout", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": "model: a/b\nagent-minutes: 90\nwrap-up-minutes: 15\n",
  });
  platform.maintainers.add("alice");
  platform.openIssue("alice", "Add a cache");
  const runtime = new FakeRuntime({ inputs: { workdir } });
  await select(fakeServices(platform, runtime));
  const { settings } = readTask(runtime);
  assert.equal(settings["agent-minutes"], 90);
  assert.equal(settings["wrap-up-minutes"], 15);
  const [task] = JSON.parse(runtime.outputs.tasks ?? "") as Record<string, string>[];
  assert.equal(task?.["agent-job-minutes"], "115", "both times, and the job's 10 minutes");
});

test("select resolves a task's commands, a manual run's inputs, the file, then the organization's settings", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": "model: file/model\nmax-runs: 9\n",
  });
  platform.maintainers.add("alice");
  platform.openIssue("alice", "Add a cache", "Cache responses.\n\n/codeman set task-budget 5");
  const shared = [
    "# Shared by the organization",
    "model: org/model",
    "task-budget: 4",
    "monthly-budget: 40",
    "max-runs: 6",
    "max-files: 50",
  ].join("\n");
  const runtime = new FakeRuntime({
    inputs: { workdir, "monthly-budget": "30", settings: shared },
  });
  await select(fakeServices(platform, runtime));
  const { settings } = readTask(runtime);
  assert.deepEqual(
    [
      settings.model,
      settings["task-budget"],
      settings["monthly-budget"],
      settings["max-runs"],
      settings["max-files"],
      settings["max-options"],
    ],
    ["file/model", 5, 30, 9, 50, 4],
  );
  assert.deepEqual(
    runtime.logged("info").filter((line) => line.startsWith("Settings from")),
    [
      "Settings from the task's commands: task-budget=5.",
      "Settings from the workflow's inputs: monthly-budget=30.",
      "Settings from .codeman/settings.yml: model=file/model, max-runs=9.",
      "Settings from the `settings` input (organization variable CODEMAN_SETTINGS): max-files=50.",
    ],
  );

  const [task] = JSON.parse(runtime.outputs.tasks ?? "") as Record<string, string>[];
  assert.equal(task?.["organization-monthly-budget"], "", "none unless the organization sets it");
  const budgeted = new FakeRuntime({
    inputs: { workdir, settings: `${shared}\norganization-monthly-budget: 100` },
  });
  await select(fakeServices(platform, budgeted));
  const [limited] = JSON.parse(budgeted.outputs.tasks ?? "") as Record<string, string>[];
  assert.equal(limited?.["organization-monthly-budget"], "100");

  // Without a file, the organization's settings are enough.
  const alone = new FakePlatform({});
  alone.maintainers.add("alice");
  alone.openIssue("alice", "Add a cache");
  const fromOrganization = new FakeRuntime({ inputs: { workdir, settings: shared } });
  await select(fakeServices(alone, fromOrganization));
  assert.equal(readTask(fromOrganization).model, "org/model");

  // Malformed settings stop the run, named as the organization's, not the file.
  const malformed = new FakeRuntime({
    inputs: { workdir, settings: "model: a/b\ngpu: x; rm\n" },
  });
  await assert.rejects(select(fakeServices(platform, malformed)), {
    message:
      "the `settings` input (organization variable CODEMAN_SETTINGS), line 2: the value of `gpu` is not a plain value.",
  });
});

test("pods: select hands the task's pods to the key jobs, and apply takes the ledger's spend", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": 'provider: runpod-pod\nmodel: qwen3-coder:30b\ngpu: "GPU A"\n',
  });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a cache", "Cache responses.");
  const step = async (runId: string) => {
    const selected = new FakeRuntime({ inputs: { workdir }, runId });
    await select(fakeServices(platform, selected));
    return selected;
  };
  const applied = async (runId: string, inputs: Record<string, string>) => {
    const runtime = new FakeRuntime({
      inputs: {
        workdir,
        "key-job-result": "success",
        "key-status": "opened",
        "agent-job-result": "success",
        ...inputs,
      },
      runId,
    });
    await apply(fakeServices(platform, runtime));
    return runtime;
  };

  let selected = await step("1");
  const first = JSON.parse(selected.outputs.inference ?? "");
  assert.match(first.concurrency?.key ?? "", /^[0-9a-f]{16}$/, "the batch key");
  assert.deepEqual(first, {
    provider: "runpod-pod",
    engine: "ollama",
    model: "qwen3-coder:30b",
    pods: [],
    accounts: ["runpod"],
    recorded: { spent: 0 },
    gpu: "GPU A",
    podReuse: "task",
    // One task at a time without counts: `num-parallel` defaults to 1.
    parallel: 1,
    // A batch of one, on a pod: its document lets the registry size the pod.
    batch: "1-1-0",
    // The organization alone, without `pool`.
    pool: { id: "o", members: ["o"] },
    // One pod at a time, of one task, by default.
    concurrency: { key: first.concurrency.key, instances: 1, tasks: 1 },
  });
  const task = readTask(selected);
  agentResult({ [task.planPath]: "# Plan\n" }, { summary: "Plan.", language: "en", decisions: [] });
  let runtime = await applied("1", {
    "task-spent": "0",
    "run-cost": "0.3000",
    pod: "pod1",
    "task-total": "0.3000",
    "task-costs": '{"1":0.3}',
  });
  assert.equal(runtime.outputs.continues, "true", "ready: the next run routes it");
  assert.deepEqual(record(platform, issue)?.inference, { pods: [{ id: "pod1", runs: ["1"] }] });
  assert.equal(record(platform, issue)?.spent, 0.3);

  // The kept pod serves the routing run; its billing includes the time it waited.
  selected = await step("2");
  const choice = JSON.parse(selected.outputs.inference ?? "") as {
    recorded: { spent: number };
    pods: string[];
  };
  assert.deepEqual(choice.recorded, { spent: 0.3 });
  assert.deepEqual(choice.pods, ["pod1"]);
  routeResult(["code"]);
  // close-key's figures from the ledger, where the pod's cost passed its runs'.
  runtime = await applied("2", {
    "task-spent": "0.3000",
    "run-cost": "0.1000",
    pod: "pod1",
    "task-total": "0.5000",
    "task-costs": '{"1":0.3,"2":0.1}',
  });
  assert.equal(runtime.outputs.continues, "true", "the code stage runs next");
  const updated = record(platform, issue);
  assert.equal(updated?.spent, 0.5, "the ledger's total");
  assert.deepEqual(updated?.inference, { pods: [{ id: "pod1", runs: ["1", "2"] }] });
  assert.deepEqual(
    updated?.spending?.rows.map((row) => row.cost),
    [0.3, 0.1],
    "a pod that served two runs refreshes neither",
  );
  assert.deepEqual(
    updated?.spending?.rows.map((row) => row.provider),
    ["runpod-pod", "runpod-pod"],
  );
});

test("a shared pod: apply marks it in the record, and its billing no longer reaches the key jobs", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": 'provider: runpod-pod\nmodel: qwen3-coder:30b\ngpu: "GPU A"\n',
  });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a cache", "Cache responses.");
  let selected = new FakeRuntime({ inputs: { workdir }, runId: "1" });
  await select(fakeServices(platform, selected));
  const task = readTask(selected);
  agentResult({ [task.planPath]: "# Plan\n" }, { summary: "Plan.", language: "en", decisions: [] });
  const runtime = new FakeRuntime({
    inputs: {
      workdir,
      task: String(issue),
      "key-job-result": "success",
      "key-status": "opened",
      "agent-job-result": "success",
      "task-spent": "0",
      "run-cost": "0.0600",
      pod: "pod1",
      "pod-shared": "true",
      "task-total": "0.0600",
    },
    runId: "1",
  });
  await apply(fakeServices(platform, runtime));
  assert.deepEqual(record(platform, issue)?.inference, {
    pods: [{ id: "pod1", runs: ["1"], shared: true }],
  });
  selected = new FakeRuntime({ inputs: { workdir }, runId: "2" });
  await select(fakeServices(platform, selected));
  const choice = JSON.parse(selected.outputs.inference ?? "") as {
    pods: string[];
    recorded: { spent: number };
  };
  assert.deepEqual(choice.pods, [], "the gateway's share counts it, not Runpod's bill");
  assert.equal(choice.recorded.spent, 0.06);
});

test("each row keeps its run's provider, older rows read as before, and the oldest show a dash", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  // The plan's row, as records written before rows kept their provider hold it: without one,
  // and with the older `inference`.
  const panel = platform.comments.get(issue)?.find((comment) => isStatusComment(comment.body));
  const before = record(platform, issue);
  const planRow = before?.spending?.rows[0];
  assert.ok(panel && before && planRow);
  assert.equal(planRow.provider, "openrouter");
  const { provider: _, ...oldRow } = planRow;
  const olderRow = { ...oldRow, inference: "pod" };
  panel.body = panel.body.replace(
    /<!-- codeman:status [A-Za-z0-9_-]* -->/,
    encodeStatus({ ...before, spending: { rows: [oldRow, olderRow, planRow] } }),
  );

  // The task moves to Serverless before it is routed.
  const main = await platform.branchSha("main");
  assert.ok(main);
  await platform.commit({
    branch: "main",
    baseSha: main,
    createBranch: false,
    changes: [
      {
        path: ".codeman/settings.yml",
        content: Buffer.from(
          "provider: runpod-serverless\nendpoint: abc123\nmodel: Qwen/Qwen3-Coder-30B-A3B-Instruct\n",
        ),
      },
    ],
    message: "Use Serverless",
  });
  const selected = await selectStep(platform);
  assert.equal(JSON.parse(selected.outputs.inference ?? "").provider, "runpod-serverless");
  routeResult(["code"]);
  await applyStep(platform);
  assert.deepEqual(
    record(platform, issue)?.spending?.rows.map((row) => row.provider ?? row.inference),
    [undefined, "pod", "openrouter", "runpod-serverless"],
  );
  const shown = platform.botComments(issue).find((body) => body.includes("codeman:status")) ?? "";
  assert.match(shown, /\| Month \(estimated\) \|/);
  for (const provider of ["—", "Runpod \\(pod\\)", "OpenRouter", "Runpod \\(Serverless\\)"]) {
    assert.match(shown, new RegExp(`\\| \`[^\`]*\` \\| ${provider} \\|`));
  }
  assert.match(
    shown,
    /\n\*\*OpenRouter\*\*: [^\n]*\n\n\*\*Runpod \(pod\)\*\*: [^\n]*\n\n\*\*Runpod \(Serverless\)\*\*: /,
  );
  const run = platform.botComments(issue).at(-1) ?? "";
  assert.match(run, /\| Runpod \(Serverless\) \|/);
  assert.match(run, /\*\*Runpod \(Serverless\)\*\*: /);
  assert.ok(!run.includes("**OpenRouter**"), "a run comment has its own row's note");
});

test("profiles: a task planned on OpenRouter and coded on a pod adds up both providers", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": [
      "model: a/b",
      "profiles:",
      "  - name: planner",
      "    stages: [plan]",
      "    model: c/d",
      "  - name: small-pod",
      "    stages: [code]",
      "    provider: runpod-pod",
      "    gpu: NVIDIA RTX A6000",
      "    model: qwen3-coder:30b",
    ].join("\n"),
  });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a limiter", "Limit requests.");
  const step = async (runId: string) => {
    const selected = new FakeRuntime({ inputs: { workdir }, runId });
    await select(fakeServices(platform, selected));
    return { selected, choice: JSON.parse(selected.outputs.inference ?? "") };
  };
  const applied = async (runId: string, inputs: Record<string, string>) => {
    const runtime = new FakeRuntime({
      inputs: {
        workdir,
        "key-job-result": "success",
        "key-status": "opened",
        "agent-job-result": "success",
        ...inputs,
      },
      runId,
    });
    await apply(fakeServices(platform, runtime));
  };
  const spent = () => record(platform, issue)?.spent ?? 0;

  // Planning on OpenRouter, with the planner's model.
  let { selected, choice } = await step("1");
  assert.equal(selected.outputs.model, "c/d");
  assert.ok(selected.logged("info").includes("Profile `planner` applies to this run."));
  assert.deepEqual(choice, {
    provider: "openrouter",
    profile: "planner",
    accounts: ["openrouter", "runpod"],
    recorded: { spent: 0 },
    pool: { id: "o", members: ["o"] },
    concurrency: { key: choice.concurrency.key, instances: 1, tasks: 1 },
  });
  const { planPath } = readTask(selected);
  agentResult({ [planPath]: "# Plan\n" }, { summary: "Adds a limiter.", decisions: [] });
  await applied("1", {
    "task-spent": "0",
    "run-cost": "0.25",
    "task-total": "0.25",
    "task-costs": '{"1":0.25}',
  });

  // Routing has no profile: the top-level settings.
  ({ selected, choice } = await step("2"));
  assert.equal(selected.outputs.model, "a/b");
  assert.equal(choice.profile, undefined);
  routeResult(["code", "review"]);
  await applied("2", {
    "task-spent": "0.25",
    "run-cost": "0.125",
    "task-total": "0.375",
    "task-costs": '{"1":0.25,"2":0.125}',
  });
  assert.equal(spent(), 0.375);

  // Coding on a pod: the ledger adds its spend to OpenRouter's runs.
  ({ selected, choice } = await step("3"));
  assert.deepEqual(
    [choice.provider, choice.profile, choice.model, choice.recorded],
    ["runpod-pod", "small-pod", "qwen3-coder:30b", { spent: 0.375 }],
  );
  agentResult(
    { "src/limit.ts": "export const limit = 10;\n" },
    { status: "done", summary: "Added the limiter.", commitMessage: "Add a limiter" },
  );
  await applied("3", {
    "task-spent": "0.375",
    "run-cost": "0.5",
    pod: "pod1",
    "task-total": "0.875",
    "task-costs": '{"1":0.25,"2":0.125,"3":0.5}',
  });
  assert.equal(spent(), 0.875);

  // Review on OpenRouter again: the ledger counts every provider's runs.
  ({ selected, choice } = await step("4"));
  assert.equal(choice.provider, "openrouter");
  assert.deepEqual(choice.recorded, { spent: 0.875 });
  agentResult({}, { status: "done", summary: "Looks right." });
  await applied("4", {
    "task-spent": "0.875",
    "run-cost": "0.0625",
    "task-total": "0.9375",
    "task-costs": '{"1":0.25,"2":0.125,"3":0.5,"4":0.0625}',
  });
  assert.equal(spent(), 0.9375, "0.4375 on OpenRouter and 0.5 on the pod");
  const rows = record(platform, issue)?.spending?.rows ?? [];
  assert.deepEqual(
    rows.map((row) => [row.stage, row.model, row.provider, row.cost]),
    [
      ["plan", "c/d", "openrouter", 0.25],
      ["route", "a/b", "openrouter", 0.125],
      ["code", "qwen3-coder:30b", "runpod-pod", 0.5],
      ["review", "a/b", "openrouter", 0.0625],
    ],
  );
  const shown = platform.botComments(issue).find((body) => body.includes("codeman:status")) ?? "";
  assert.match(shown, /\| `qwen3-coder:30b` \| Runpod \(pod\) \|/);
  assert.match(shown, /\| `c\/d` \| OpenRouter \|/);
});

test("a run whose provider's secret is missing blocks the task, and says which", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a limiter", "Limit requests.");
  await selectStep(platform);
  const runtime = new FakeRuntime({
    inputs: {
      workdir,
      "key-job-result": "success",
      "key-status": "missing-credentials",
      "key-reason":
        "The inference settings name a provider whose secret the workflow does not pass: `CODEMAN_RUNPOD_API_KEY`.",
      "agent-job-result": "skipped",
    },
  });
  await apply(fakeServices(platform, runtime));
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  const run = platform.botComments(issue).at(-1) ?? "";
  assert.match(run, /does not pass the secret of a provider/);
  assert.match(run, /`CODEMAN_RUNPOD_API_KEY`/);
});

test("profiles: a task's model is for the top level's provider, and is reported where it does not fit", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": [
      "model: a/b",
      "profiles:",
      "  - name: small-pod",
      "    stages: [plan]",
      "    provider: runpod-pod",
      '    gpu: "NVIDIA RTX A6000"',
      "    model: qwen3-coder:30b",
    ].join("\n"),
  });
  platform.maintainers.add("alice");
  platform.openIssue(
    "alice",
    "Add a limiter",
    "Limit requests.\n\n/codeman set model deepseek/deepseek-v4.1-flash\n/codeman set gpu NVIDIA RTX A5000",
  );
  // The profile is on another provider: it keeps its own model, and takes the task's GPU.
  const planned = await selectStep(platform);
  assert.equal(planned.outputs.model, "qwen3-coder:30b");
  const choice = JSON.parse(planned.outputs.inference ?? "");
  assert.deepEqual([choice.profile, choice.gpu], ["small-pod", "NVIDIA RTX A5000"]);
  assert.deepEqual(readTask(planned).problems, []);

  // Without the profile, the task's model does not fit OpenRouter: the run goes on without it.
  const other = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  other.maintainers.add("alice");
  other.openIssue("alice", "Add a cache", "Cache.\n\n/codeman set model qwen3-coder:480b");
  const fallback = await selectStep(other);
  assert.equal(fallback.outputs.model, "a/b");
  assert.deepEqual(
    readTask(fallback).problems.map((error) => error.problem.kind),
    ["settings-rejected"],
  );

  // A profile on another provider without its own model stops the run in `select`, before any
  // key job, even when the task sets a model.
  const unset = new FakePlatform({
    ".codeman/settings.yml": [
      "model: a/b",
      "profiles:",
      "  - name: small-pod",
      "    stages: [code]",
      "    provider: runpod-pod",
      '    gpu: "NVIDIA RTX A6000"',
    ].join("\n"),
  });
  unset.maintainers.add("alice");
  unset.openIssue("alice", "Add a queue", "Queue.\n\n/codeman set model qwen3-coder:30b");
  const stopped = new FakeRuntime({ inputs: { workdir } });
  await assert.rejects(select(fakeServices(unset, stopped)), {
    message:
      "Profile `small-pod` names `runpod-pod`, but inherits `openrouter` from the top level, so it must set its own `model`, one for `runpod-pod`.",
  });
  assert.equal(stopped.outputs.action, undefined);
});

/** Runs one task's apply job, as a leg of the run's matrix does: with its `task` input. */
async function applyLeg(
  platform: FakePlatform,
  task: string,
  inputs: Record<string, string>,
): Promise<FakeRuntime> {
  const runtime = new FakeRuntime({ inputs: { workdir, task, ...inputs } });
  await apply(fakeServices(platform, runtime));
  return runtime;
}

const opened = { "key-job-result": "success", "key-status": "opened" };

/** The tasks whose apply marked them as moved, for next-run, since the last `clearMarks`. */
function marks(): string[] {
  const dir = join(workdir, "chain");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function clearMarks(): void {
  rmSync(join(workdir, "chain"), { recursive: true, force: true });
}

test("parallel tasks: one run plans two, each in its own jobs, and one that fails leaves the other", async () => {
  clearMarks();
  const platform = new FakePlatform({
    ".codeman/settings.yml": [
      "model: a/b",
      "task-budget: 3",
      "profiles:",
      "  - name: crowded",
      "    tasks: 2",
      "    model: c/d",
    ].join("\n"),
  });
  platform.maintainers.add("alice");
  const first = platform.openIssue("alice", "Add rate limiting", "Limit requests.");
  const second = platform.openIssue("alice", "Add a cache", "Cache responses.");
  const third = platform.openIssue("alice", "Add logging", "Log requests.");

  const selected = await selectStep(platform);
  const tasks = JSON.parse(selected.outputs.tasks ?? "") as Record<string, string>[];
  assert.deepEqual(
    tasks.map((task) => [task.task, task.action, task["needs-agent"], task.stage]),
    [
      ["1", "plan", "true", "plan"],
      ["2", "plan", "true", "plan"],
    ],
  );
  assert.ok(
    selected
      .logged("info")
      .includes("Picked 2 task(s), of up to 2: #1 (plan), #2 (plan); 2 run an agent."),
  );
  // The first task's outputs, one each, for workflow files from before parallel tasks.
  assert.deepEqual(
    [selected.outputs.task, selected.outputs.action, selected.outputs.inference],
    ["1", "plan", tasks[0]?.inference],
  );
  // Two agents at once: the profile for two tasks applies to both. The ledger keeps them within
  // the month together.
  const [one, two] = tasks.map((task) => JSON.parse(task.inference ?? ""));
  assert.deepEqual([one.profile, two.profile], ["crowded", "crowded"]);
  assert.deepEqual(stateLabels(platform, first), ["codeman:planning"]);
  assert.deepEqual(stateLabels(platform, second), ["codeman:planning"]);
  assert.deepEqual(stateLabels(platform, third), [], "the third waits for the next run");

  // Each leg reads its own task's context.
  const context = (task: string) => readTask(new FakeRuntime({ inputs: { workdir, task } }));
  assert.deepEqual(
    [context("1").number, context("2").number, context("2").model],
    [first, second, "c/d"],
  );
  assert.equal(readTask(selected).number, first, "task.json is the first task's");
  assert.throws(() => context("3"), /ENOENT/);
  assert.throws(() => context("../task"), /issue number/);

  // The first task's agent fails; the second plans. Each apply writes only its own task.
  const failed = await applyLeg(platform, "1", { ...opened, "agent-job-result": "failure" });
  agentResult({ [context("2").planPath]: "# Plan\n" }, { summary: "Caches.", decisions: [] });
  const planned = await applyLeg(platform, "2", { ...opened, "agent-job-result": "success" });
  assert.deepEqual(stateLabels(platform, first), ["codeman:blocked"]);
  assert.deepEqual(stateLabels(platform, second), ["codeman:ready"]);
  assert.equal(platform.file(context("2").branch, context("2").planPath), "# Plan\n");
  assert.equal(platform.file(context("1").branch, context("1").planPath), undefined);
  assert.ok(!platform.botComments(first).some((body) => body.includes("Caches.")));

  // Both moved, the failed one too, as a single task's run does: next-run starts another.
  assert.deepEqual([failed.outputs.chain, planned.outputs.chain], ["true", "true"]);
  assert.deepEqual(marks(), ["1", "2"]);

  // The next run picks the third task, and the second goes on to routing.
  clearMarks();
  const next = await selectStep(platform);
  assert.deepEqual(
    (JSON.parse(next.outputs.tasks ?? "") as Record<string, string>[]).map((task) => [
      task.task,
      task.action,
    ]),
    [
      ["3", "plan"],
      ["2", "route"],
    ],
  );
});

test("parallel tasks: next-run starts another run only when some task moved", async () => {
  clearMarks();
  const platform = new FakePlatform({
    ".codeman/settings.yml": "model: a/b\nprofiles:\n  - name: three\n    max-tasks: 3\n",
  });
  platform.maintainers.add("alice");
  const asked = platform.openIssue("alice", "Add rate limiting", "Limit requests.");
  const selected = await selectStep(platform);
  assert.equal(JSON.parse(selected.outputs.tasks ?? "").length, 1, "one task to pick");
  agentResult(
    { [readTask(selected).planPath]: "# Plan\n" },
    {
      summary: "Adds a limiter.",
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
  await applyLeg(platform, "1", { ...opened, "agent-job-result": "success" });
  assert.deepEqual(stateLabels(platform, asked), ["codeman:awaiting-decision"]);

  // An answer to record, which runs no agent, and a new task, which the month refuses.
  platform.say(asked, "alice", "/codeman decide 1 b");
  const refused = platform.openIssue("alice", "Add a cache", "Cache responses.");
  clearMarks();
  const run = await selectStep(platform);
  const tasks = JSON.parse(run.outputs.tasks ?? "") as Record<string, string>[];
  assert.deepEqual(
    tasks.map((task) => [task.task, task.action, task["needs-agent"]]),
    [
      ["1", "record", "false"],
      ["2", "plan", "true"],
    ],
  );
  await applyLeg(platform, "1", { "key-job-result": "skipped", "agent-job-result": "skipped" });
  await applyLeg(platform, "2", {
    "key-job-result": "success",
    "key-status": "over-budget",
    "key-reason": "The monthly budget is reached.",
    "agent-job-result": "skipped",
  });
  assert.deepEqual(stateLabels(platform, asked), ["codeman:ready"]);
  assert.deepEqual(stateLabels(platform, refused), [], "back to where it was");
  const panel = platform.botComments(refused).find((body) => body.includes("codeman:status"));
  assert.match(panel ?? "", /The monthly budget is reached/);
  assert.deepEqual(marks(), ["1"], "the answers moved a task");

  // A run whose only task the month refuses moved nothing: no mark, so no other run.
  clearMarks();
  const alone = new FakePlatform({
    ".codeman/settings.yml": "model: a/b\nprofiles:\n  - name: two\n    max-tasks: 2\n",
  });
  alone.maintainers.add("alice");
  alone.openIssue("alice", "Add a cache", "Cache responses.");
  await selectStep(alone);
  const over = await applyLeg(alone, "1", {
    "key-job-result": "success",
    "key-status": "over-budget",
    "agent-job-result": "skipped",
  });
  assert.equal(over.outputs.chain, undefined);
  assert.deepEqual(marks(), []);

  // The organization's month refuses a run the same way, and says so.
  const organization = new FakePlatform({
    ".codeman/settings.yml": "model: a/b\n",
  });
  organization.maintainers.add("alice");
  const limited = organization.openIssue("alice", "Add a cache", "Cache responses.");
  await select(
    fakeServices(
      organization,
      new FakeRuntime({ inputs: { workdir, settings: "organization-monthly-budget: 30" } }),
    ),
  );
  const shared = await applyLeg(organization, "1", {
    "key-job-result": "success",
    "key-status": "over-organization-budget",
    "organization-month-spent": "29.5",
    "agent-job-result": "skipped",
  });
  assert.equal(shared.outputs.chain, undefined);
  assert.deepEqual(stateLabels(organization, limited), [], "back to where it was");
  const status = organization.botComments(limited).find((body) => body.includes("codeman:status"));
  assert.match(
    status ?? "",
    /The organization's monthly budget is reached: US\$ 29\.50 used of US\$ 30\.00, and this run may use up to US\$ 2\.00\. Codeman will try again in a later run\./,
  );
});

test("a routing run the budget refuses updates the panel only", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  const runComments = () => platform.botComments(issue).filter(isRunComment).length;
  const planned = runComments();
  const panel = () => platform.botComments(issue).find((body) => body.includes("codeman:status"));

  const refusals: [string, Record<string, string>, RegExp][] = [
    ["", { "key-status": "over-budget" }, /The monthly budget is reached/],
    [
      "organization-monthly-budget: 30",
      { "key-status": "over-organization-budget", "organization-month-spent": "29.5" },
      /The organization's monthly budget is reached/,
    ],
  ];
  for (const [settings, status, message] of refusals) {
    const selected = new FakeRuntime({ inputs: { workdir, settings } });
    await select(fakeServices(platform, selected));
    assert.equal(selected.outputs.action, "route");
    const refused = await applyLeg(platform, "1", {
      "key-job-result": "success",
      ...status,
      "agent-job-result": "skipped",
    });
    assert.deepEqual(stateLabels(platform, issue), ["codeman:ready"]);
    assert.equal(refused.outputs.chain, undefined);
    assert.match(panel() ?? "", message);
    assert.equal(runComments(), planned, "no run comment for a run that moved nothing");
  }

  // Once the month has room, the routing run moves the task and reports it.
  await routeStep(platform, ["code", "review"]);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:coding"]);
  assert.equal(runComments(), planned + 1);
});

/** Writes `.codeman/settings.yml` on the default branch, as a maintainer's commit does. */
async function writeSettings(platform: FakePlatform, text: string): Promise<void> {
  const main = await platform.branchSha("main");
  assert.ok(main);
  await platform.commit({
    branch: "main",
    baseSha: main,
    createBranch: false,
    changes: [{ path: ".codeman/settings.yml", content: Buffer.from(text) }],
    message: "Change Codeman's settings",
  });
}

/** Tasks ready to route, whose plans have no decisions. */
function readyTasks(platform: FakePlatform, count: number): number[] {
  platform.maintainers.add("alice");
  return Array.from({ length: count }, (_, index) =>
    platform.openIssue("alice", `Task ${index + 1}`, "Do it.", ["codeman", "codeman:ready"]),
  );
}

/** Each picked task's number, action and profile. */
function pickedTasks(runtime: FakeRuntime): [string, string, string][] {
  const tasks = JSON.parse(runtime.outputs.tasks ?? "[]") as Record<string, string>[];
  return tasks.map((task) => [
    task.task ?? "",
    task.action ?? "",
    JSON.parse(task.inference ?? "{}").profile ?? "",
  ]);
}

/** Each picked task's `parallel`, the most tasks its profile serves at once. */
function parallels(runtime: FakeRuntime): (number | undefined)[] {
  const tasks = JSON.parse(runtime.outputs.tasks ?? "[]") as Record<string, string>[];
  return tasks.map((task) => JSON.parse(task.inference ?? "{}").parallel);
}

const withoutMig = () => exampleSettings().replace(/ {2}- name: mig\n[\s\S]*$/, "");

test("profiles pick the tasks: 4 on the full GPU, up to 3 on the MIG partition", async () => {
  const four = new FakePlatform({ ".codeman/settings.yml": exampleSettings() });
  readyTasks(four, 5);
  let selected = await selectStep(four);
  assert.deepEqual(pickedTasks(selected), [
    ["1", "route", "parallel-tasks"],
    ["2", "route", "parallel-tasks"],
    ["3", "route", "parallel-tasks"],
    ["4", "route", "parallel-tasks"],
  ]);
  const gpu = JSON.parse(selected.outputs.inference ?? "").gpu;
  assert.equal(gpu, "NVIDIA RTX PRO 6000 Blackwell Server Edition");
  // Its pods serve 4 requests at once, unless its `ollama` settings say otherwise.
  assert.deepEqual(parallels(selected), [4, 4, 4, 4]);
  assert.ok(
    selected
      .logged("info")
      .includes(
        "Picked 4 task(s), of up to 4: #1 (route), #2 (route), #3 (route), #4 (route); 4 run an agent.",
      ),
  );
  // The fifth is left for the next run, with no message.
  assert.deepEqual(four.botComments(5), []);

  const three = new FakePlatform({ ".codeman/settings.yml": exampleSettings() });
  readyTasks(three, 3);
  selected = await selectStep(three);
  assert.deepEqual(
    pickedTasks(selected).map(([, , profile]) => profile),
    ["mig", "mig", "mig"],
  );
  assert.deepEqual(parallels(selected), [3, 3, 3], "up to 3 on the MIG partition");

  // A count is a batch's: a planning task is a batch of its own on OpenRouter, and the three
  // others a batch of 3 on the MIG partition (decision 12 of the plan for GPU batches).
  const mixed = new FakePlatform({ ".codeman/settings.yml": exampleSettings() });
  readyTasks(mixed, 3);
  mixed.openIssue("alice", "A new task", "Plan it.");
  selected = await selectStep(mixed);
  assert.deepEqual(pickedTasks(selected), [
    ["4", "plan", "planner"],
    ["1", "route", "mig"],
    ["2", "route", "mig"],
    ["3", "route", "mig"],
  ]);
});

test("profiles pick the tasks: tasks served only with more than are ready wait, and say so once", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": withoutMig() });
  const tasks = readyTasks(platform, 3);
  const first = new FakeRuntime({ inputs: { workdir }, runId: "1" });
  await select(fakeServices(platform, first));
  assert.equal(first.outputs.action, "none", "no task job, and no next run");
  for (const task of tasks) {
    assert.deepEqual(stateLabels(platform, task), ["codeman:ready"], "the labels stay");
    const [panel = ""] = platform.botComments(task);
    assert.match(
      panel,
      /Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are, in 1 repository\. Codeman checks again at every run\./,
    );
    assert.match(panel, /Model: `qwen3-coder:30b`/);
  }
  assert.ok(
    first
      .logged("info")
      .includes(
        "#1 Task 1: waits for 4 tasks ready for profile `parallel-tasks`; 3 are, in 1 repository.",
      ),
  );
  // The next run finds them still waiting, and leaves the panels alone.
  const panels = tasks.map((task) => platform.botComments(task));
  const second = new FakeRuntime({ inputs: { workdir }, runId: "2" });
  await select(fakeServices(platform, second));
  assert.deepEqual(
    tasks.map((task) => platform.botComments(task)),
    panels,
  );
  // A fourth makes 4: they run together.
  readyTasks(platform, 1);
  const third = await selectStep(platform);
  assert.deepEqual(
    pickedTasks(third).map(([task, , profile]) => [task, profile]),
    [
      ["1", "parallel-tasks"],
      ["2", "parallel-tasks"],
      ["3", "parallel-tasks"],
      ["4", "parallel-tasks"],
    ],
  );
});

test("concurrency: a profile's busy instances hold its other tasks back, which say why", async () => {
  // One task per instance, two instances; another profile's count lets a run take 3 tasks.
  const settings = [
    "profiles:",
    "  - name: single",
    "    stages: [route]",
    "    max-tasks: 1",
    "    model: c/d",
    "    concurrency: 2",
    "  - name: wide",
    "    stages: [plan]",
    "    tasks: 3",
    "    model: e/f",
  ].join("\n");
  const store = new MemoryStore();
  const platform = new FakePlatform({ ".codeman/settings.yml": settings });
  const tasks = readyTasks(platform, 3);
  const first = new FakeRuntime({ inputs: { workdir }, runId: "1" });
  await select(fakeServices(platform, first, undefined, undefined, undefined, store));
  assert.deepEqual(pickedTasks(first), [
    ["1", "route", "single"],
    ["2", "route", "single"],
  ]);
  const [, , third = 0] = tasks;
  assert.deepEqual(stateLabels(platform, third), ["codeman:ready"], "the labels stay");
  assert.match(
    platform.botComments(third)[0] ?? "",
    /Waiting for profile `single`: its 2 instances are busy, as many as its `concurrency` allows\. Codeman checks again at every run\./,
  );
  assert.ok(
    first
      .logged("info")
      .includes(
        "#3 Task 3: waits for a seat; the 2 instance(s) of profile `single` that its `concurrency` allows are busy.",
      ),
  );
  // Each picked run carries its key to the ledger, which open-key counts.
  const picked = await store.query("organizations/o/runs");
  const keys = new Set(picked.map((document) => document.fields.key));
  assert.equal(keys.size, 1);

  // While both runs are open, another repository of the organization starts none of its own.
  const later = new Date(Date.now() + 3_600_000);
  await store.write(
    picked.map((document) => ({
      op: "set" as const,
      path: document.path,
      fields: { status: "open", reservedAt: new Date(), expiresAt: later, limit: 1 },
      merge: true,
    })),
  );
  const other = new FakePlatform({ ".codeman/settings.yml": settings }, { owner: "o", name: "s" });
  readyTasks(other, 1);
  const busy = new FakeRuntime({
    inputs: { workdir },
    runId: "2",
    repository: { owner: "o", name: "s" },
  });
  await select(fakeServices(other, busy, undefined, undefined, undefined, store));
  assert.equal(busy.outputs.action, "none");
});

test("profiles pick the tasks: a stage nothing serves blocks the task, which continue resumes", async () => {
  // A task never planned: no profile serves planning, and the top level has no model.
  const unplanned = new FakePlatform({
    ".codeman/settings.yml": exampleSettings().replace(/ {2}- name: planner\n.*\n.*\n/, ""),
  });
  unplanned.maintainers.add("alice");
  const fresh = unplanned.openIssue("alice", "Add a limiter", "Limit requests.");
  const stopped = await selectStep(unplanned);
  assert.equal(stopped.outputs.action, "none");
  assert.deepEqual(stateLabels(unplanned, fresh), ["codeman:blocked"]);
  const [panel = ""] = unplanned.botComments(fresh);
  assert.match(
    panel,
    /No settings apply to the plan stage: no profile serves it with any number of tasks, and the top-level settings have no `model`\./,
  );
  assert.match(panel, /Remove the `codeman:blocked` label to try again\./);
  assert.ok(!panel.includes("Model:"), "no model to show");
  assert.ok(
    stopped
      .logged("warning")
      .includes("#1 Add a limiter: no settings apply to the plan stage at any count; blocked."),
  );

  // A planned task, whose settings no longer serve routing.
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  const { issue } = await plannedTask(platform);
  await writeSettings(
    platform,
    "profiles:\n  - name: planner\n    stages: [plan]\n    model: a/b\n",
  );
  const asked = platform.say(issue, "alice", "/codeman continue");
  let selected = await selectStep(platform);
  assert.equal(selected.outputs.action, "none");
  assert.deepEqual(stateLabels(platform, issue), ["codeman:blocked"]);
  const blocked = platform.botComments(issue).find((body) => body.includes("codeman:status")) ?? "";
  assert.match(blocked, /No settings apply to the routing stage/);
  assert.match(blocked, /Comment `\/codeman continue <guidance>` to try again\./);
  assert.equal(record(platform, issue)?.processedCommentId, asked, "the continue is handled");
  // Nothing new: the task stays blocked, and no run starts.
  selected = await selectStep(platform);
  assert.equal(selected.outputs.action, "none");

  // The settings fixed, `continue` routes it.
  await writeSettings(platform, "model: a/b\n");
  platform.say(issue, "alice", "/codeman continue");
  selected = await selectStep(platform);
  assert.deepEqual([selected.outputs.action, selected.outputs.stage], ["route", "route"]);
  assert.deepEqual(readTask(selected).route, { trigger: "continue", fallback: "design" });
});

test("profiles pick the tasks: runs without an agent need no model, and go first", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": exampleSettings() });
  platform.maintainers.add("alice");
  const issue = platform.openIssue("alice", "Add a limiter", "Limit requests.");
  const planned = await selectStep(platform);
  assert.equal(planned.outputs.model, "deepseek/deepseek-v4.1-flash");
  agentResult(
    { [readTask(planned).planPath]: "# Plan\n" },
    {
      summary: "Adds a limiter.",
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
  await applyStep(platform);
  assert.deepEqual(stateLabels(platform, issue), ["codeman:awaiting-decision"]);
  // An answer to record, and three tasks ready: the answer takes one of the 4 places, and the
  // three others run on the MIG partition.
  platform.say(issue, "alice", "/codeman decide 1 b");
  readyTasks(platform, 3);
  const selected = await selectStep(platform);
  assert.deepEqual(pickedTasks(selected), [
    ["1", "record", ""],
    ["2", "route", "mig"],
    ["3", "route", "mig"],
    ["4", "route", "mig"],
  ]);
  assert.equal(readTask(new FakeRuntime({ inputs: { workdir, task: "1" } })).model, "");
  await applyLeg(platform, "1", { "key-job-result": "skipped", "agent-job-result": "skipped" });
  assert.deepEqual(stateLabels(platform, issue), ["codeman:ready"]);
  const run = platform.botComments(issue).at(-1) ?? "";
  assert.match(run, /### Codeman · Answers recorded/);
  assert.ok(!run.includes("Model:"), "a run without an agent and without a model shows none");
});
