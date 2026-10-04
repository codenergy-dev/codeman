import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import type { Change, Manifest } from "../collect.ts";
import { decodeStatus, encodeStatus, isStatusComment } from "../record.ts";
import { STAGES, type Stage } from "../stages.ts";
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

/** The routing agent's output: these stages run, and the others are left out. */
function routeResult(stages: Stage[]): void {
  agentResult(
    {},
    {
      status: "done",
      summary: `Runs ${stages.join(", ")}.`,
      route: stages.map((stage) => ({ stage, brief: `Brief for ${stage}.` })),
      skipped: STAGES.filter((stage) => !stages.includes(stage)).map((stage) => ({
        stage,
        reason: `No ${stage} needed.`,
      })),
    },
  );
}

/** Runs the routing agent, which chooses `stages`. */
async function routeStep(platform: FakePlatform, stages: Stage[]): Promise<FakeRuntime> {
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
  const rows = record(platform, issue)?.spending?.rows.length;
  assert.equal(rows, 4, "plan, route, design and code");
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

test("self-hosted inference: select hands the task's pods to the key jobs, and apply adds up their billing", async () => {
  const platform = new FakePlatform({
    ".codeman/settings.yml": 'inference: self-hosted\nmodel: qwen3-coder:30b\ngpu-type: "GPU A"\n',
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
  assert.deepEqual(JSON.parse(selected.outputs.inference ?? ""), {
    inference: "self-hosted",
    gpuProvider: "runpod",
    engine: "ollama",
    model: "qwen3-coder:30b",
    taskSpent: 0,
    pods: [],
    mode: "pod",
    gpuType: "GPU A",
    podReuse: "task",
  });
  const task = readTask(selected);
  agentResult({ [task.planPath]: "# Plan\n" }, { summary: "Plan.", language: "en", decisions: [] });
  let runtime = await applied("1", { "task-spent": "0", "run-cost": "0.3000", pod: "pod1" });
  assert.equal(runtime.outputs.continues, "true", "ready: the next run routes it");
  assert.deepEqual(record(platform, issue)?.inference, {
    pods: [{ id: "pod1", runs: ["1"], counted: 0.3 }],
  });
  assert.equal(record(platform, issue)?.spent, 0.3);

  // The kept pod serves the routing run; its billing includes the time it waited.
  selected = await step("2");
  const choice = JSON.parse(selected.outputs.inference ?? "") as {
    taskSpent: number;
    pods: string[];
  };
  assert.equal(choice.taskSpent, 0.3);
  assert.deepEqual(choice.pods, ["pod1"]);
  routeResult(["code"]);
  runtime = await applied("2", {
    "task-spent": "0.3000",
    "run-cost": "0.1000",
    pod: "pod1",
    "pod-costs": '{"pod1":0.5}',
  });
  assert.equal(runtime.outputs.continues, "true", "the code stage runs next");
  const updated = record(platform, issue);
  assert.ok(Math.abs((updated?.spent ?? 0) - 0.5) < 1e-9, "billing above the runs' estimates");
  assert.deepEqual(
    updated?.spending?.rows.map((row) => row.cost),
    [0.3, 0.1],
    "a pod that served two runs refreshes neither",
  );
});
