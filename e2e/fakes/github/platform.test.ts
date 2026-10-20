import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import * as github from "@actions/github";
import { GitHubActionsResults } from "../../../src/platform/github/ci.ts";
import { GitHubPlatform } from "../../../src/platform/github/platform.ts";
import type { Permissions } from "./auth.ts";
import { hasGit } from "./git.ts";
import { GitHubFake } from "./github.ts";
import { acme } from "./testing.ts";
import { readZip } from "./zip.ts";

/** Codeman's own GitHub platform, in process, against the fake: the two must agree. */

const skip = hasGit() ? false : "git is not on the PATH";
const fake = new GitHubFake();
let origin = "";
const REPOSITORY = { owner: "acme", name: "app" };

before(async () => {
  if (skip) return;
  origin = await fake.listen();
});
after(() => fake.close());
beforeEach(async () => {
  if (skip) return;
  fake.server.reset();
  await acme(fake, { "README.md": "# App\n", "docs/web/a.md": "a\n", "run.sh": "echo\n" });
});

/** Codeman's platform with an installation token of `permissions`, as a template's job gets it. */
function platform(permissions: Permissions) {
  const installation = [...fake.world.installations.values()][0];
  assert.ok(installation);
  const token = fake.world.installationToken(installation, { repositories: ["app"], permissions });
  const client = github.getOctokit(token.value, { baseUrl: `${origin}/api/v3` });
  return new GitHubPlatform(client, REPOSITORY, { serverUrl: origin, appSlug: "codeman" });
}

/** The select job's App token, and apply's (templates/codeman.yml, codeman-task.yml). */
const SELECT: Permissions = {
  contents: "read",
  issues: "write",
  pull_requests: "read",
  actions: "read",
  metadata: "read",
};
const APPLY: Permissions = { contents: "write", issues: "write", pull_requests: "write" };

test("select's platform reads tasks, labels, comments and who maintains the repository", {
  skip,
}, async () => {
  const opened = await fake.act({
    action: "open-issue",
    as: "alice",
    repository: "acme/app",
    title: "Add a route",
    body: "Please.",
    labels: ["codeman"],
  });
  const number = Number(opened.result);
  const select = platform(SELECT);
  const [task] = await select.listOptedIn();
  assert.deepEqual(
    [task?.number, task?.title, task?.labels, task?.author],
    [number, "Add a route", ["codeman"], { login: "alice", bot: false }],
  );
  await select.setState(number, ["codeman"], "planning");
  await select.setState(number, await select.currentLabels(number), "awaiting-decision");
  assert.deepEqual(await select.currentLabels(number), ["codeman", "codeman:awaiting-decision"]);
  const id = await select.upsertComment(number, null, "Which port?");
  assert.equal(await select.upsertComment(number, id, "Which port, 8080 or 3000?"), id);
  assert.equal(await select.upsertComment(number, 999_999, "Recreated"), id + 1);
  const comments = await select.listComments(number);
  assert.deepEqual(
    comments.map((comment) => [comment.body, comment.author?.bot]),
    [
      ["Which port, 8080 or 3000?", true],
      ["Recreated", true],
    ],
  );
  const maintainers = [];
  for (const login of ["olivia", "alice", "bob", "carol", "stranger", "nobody"]) {
    maintainers.push([
      login,
      await select.isMaintainer(login).catch((error: { status?: number }) => error.status),
    ]);
  }
  assert.deepEqual(maintainers, [
    ["olivia", true],
    ["alice", true],
    ["bob", false],
    ["carol", false],
    ["stranger", false],
    ["nobody", false],
  ]);
  assert.equal(select.self(), "codeman[bot]");
  assert.equal(await select.defaultBranch(), "main");
  assert.equal(await select.readFile("main", "README.md"), "# App\n");
  assert.equal(await select.readFile("main", "missing.md"), undefined);
  assert.deepEqual([...(await select.filesUnder("main", "docs/web/")).keys()], ["docs/web/a.md"]);
  assert.equal(fake.violations.length, 0);
});

test("without pull_requests: read, listing reviews fails as it did on GitHub", {
  skip,
}, async () => {
  const { pull_requests: _, ...withoutPulls } = SELECT;
  const select = platform(withoutPulls);
  await assert.rejects(select.listReviews(1), (error: { status?: number; message?: string }) => {
    assert.equal(error.status, 403);
    assert.match(error.message ?? "", /Resource not accessible by integration/);
    return true;
  });
});

test("apply's platform commits through the Git Data API, and a moved branch refuses it", {
  skip,
}, async () => {
  const apply = platform(APPLY);
  const base = await apply.branchSha("main");
  assert.ok(base);
  const first = await apply.commit({
    branch: "codeman/1",
    baseSha: base,
    createBranch: true,
    changes: [
      { path: "src/health.ts", content: Buffer.from("export const ok = true;\n") },
      { path: "run.sh", content: Buffer.from("echo ok\n"), mode: "100755" },
      { path: "docs/web/a.md", content: null },
    ],
    message: "Add a health route",
  });
  assert.equal(await apply.branchSha("codeman/1"), first);
  assert.equal(await apply.readFile("codeman/1", "src/health.ts"), "export const ok = true;\n");
  assert.equal(await apply.readFile("codeman/1", "docs/web/a.md"), undefined);
  assert.equal((await apply.filesUnder("codeman/1", "run.sh")).get("run.sh")?.mode, "100755");
  const second = await apply.commit({
    branch: "codeman/1",
    baseSha: first,
    createBranch: false,
    changes: [{ path: "src/health.ts", content: Buffer.from("export const ok = 1;\n") }],
    message: "Use a number",
  });
  assert.notEqual(second, first);
  await fake.act({
    action: "push",
    as: "alice",
    repository: "acme/app",
    branch: "codeman/1",
    files: { "NOTE.md": "mine\n" },
  });
  await assert.rejects(
    apply.commit({
      branch: "codeman/1",
      baseSha: second,
      createBranch: false,
      changes: [{ path: "src/health.ts", content: Buffer.from("lost\n") }],
      message: "Stale",
    }),
    (error: { status?: number }) => error.status === 422,
  );
  const pushes = fake.events.filter((event) => event.name === "push");
  assert.deepEqual(
    pushes.map((event) => (event.payload.sender as { login: string }).login),
    ["codeman[bot]", "codeman[bot]", "alice"],
  );
});

test("pull requests open as drafts where they can, and get ready through GraphQL", {
  skip,
}, async () => {
  const apply = platform(APPLY);
  const base = (await apply.branchSha("main")) ?? "";
  const change = (branch: string) =>
    apply.commit({
      branch,
      baseSha: base,
      createBranch: true,
      changes: [{ path: `${branch}.txt`, content: Buffer.from("x\n") }],
      message: "x",
    });
  await change("codeman/1");
  const draft = await apply.openChangeRequest({
    head: "codeman/1",
    base: "main",
    title: "Task 1",
    body: "Closes #1",
    draft: true,
  });
  assert.equal((await apply.getChangeRequest(draft)).draft, true);
  assert.equal(await apply.findChangeRequest("codeman/1"), draft);
  await apply.markReady(draft);
  assert.equal((await apply.getChangeRequest(draft)).draft, false);
  await apply.updateChangeRequest(draft, { title: "Task 1, done", body: "Closes #1" });
  assert.equal((await apply.getChangeRequest(draft)).title, "Task 1, done");
  // A plan without drafts answers 422, and Codeman opens a plain pull request instead.
  fake.world.repository("acme/app").drafts = false;
  await change("codeman/2");
  const plain = await apply.openChangeRequest({
    head: "codeman/2",
    base: "main",
    title: "Task 2",
    body: "",
    draft: true,
  });
  assert.equal((await apply.getChangeRequest(plain)).draft, false);
  await fake.act({
    action: "review",
    as: "alice",
    repository: "acme/app",
    pull: draft,
    state: "request-changes",
    body: "Use 8080.",
    comments: [{ path: "codeman/1.txt", line: 1, body: "Here." }],
  });
  const reviews = await platform(SELECT).listReviews(draft);
  assert.deepEqual(
    reviews.map((review) => [review.author?.login, review.verdict, review.body]),
    [["alice", "changes-requested", "Use 8080."]],
  );
  const lines = await platform(SELECT).listReviewComments(draft);
  assert.deepEqual(
    lines.map((line) => [line.reviewId, line.path, line.line]),
    [[reviews[0]?.id, "codeman/1.txt", 1]],
  );
  const event = fake.events.findLast((candidate) => candidate.name === "pull_request_review");
  assert.ok(event);
  assert.equal((event.payload.review as { state: string }).state, "changes_requested");
  assert.equal((event.payload.pull_request as { head: { ref: string } }).head.ref, "codeman/1");
});

test("Codeman's CI results read runs, jobs, logs and artifacts", { skip }, async () => {
  const sha = (await fake.world.repository("acme/app").git.resolve("refs/heads/main")) ?? "";
  const run = fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/ios.yml",
    event: "push",
    headSha: sha,
    status: "completed",
  });
  fake.updateRun(run.id, { conclusion: "failure" });
  const { job } = fake.startJob(run.id, "build");
  fake.finishJob(job.id, { conclusion: "failure", log: "error: no simulator\n" });
  const artifact = fake.uploadArtifact(run.id, "results", { "report.txt": "1 failed\n" });
  const token = fake.jobToken("acme/app", { contents: "read", actions: "read" });
  const ci = new GitHubActionsResults(
    github.getOctokit(token.value, { baseUrl: `${origin}/api/v3` }),
    REPOSITORY,
  );
  const [found] = await ci.runsForCommit(sha);
  assert.deepEqual([found?.id, found?.finished, found?.conclusion], [run.id, true, "failure"]);
  assert.deepEqual(await ci.runJobs(run.id), [
    { id: job.id, name: "build", conclusion: "failure" },
  ]);
  assert.equal(await ci.jobLog(job.id), "error: no simulator\n");
  assert.deepEqual(await ci.runArtifacts(run.id), [
    { id: artifact.id, name: "results", bytes: artifact.size, expired: false },
  ]);
  const zip = await ci.downloadArtifact(artifact.id);
  assert.deepEqual(
    readZip(zip).map((entry) => [entry.path, entry.data.toString()]),
    [["report.txt", "1 failed\n"]],
  );
});
