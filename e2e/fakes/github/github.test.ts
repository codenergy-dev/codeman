import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { hasGit } from "./git.ts";
import { GitHubFake } from "./github.ts";
import { acme, appJwt } from "./testing.ts";

const skip = hasGit() ? false : "git is not on the PATH";
const fake = new GitHubFake();
let origin = "";
let setup: Awaited<ReturnType<typeof acme>>;

before(async () => {
  if (skip) return;
  origin = await fake.listen({ controlToken: "control" });
});
after(() => fake.close());
beforeEach(async () => {
  if (skip) return;
  fake.server.reset();
  setup = await acme(fake);
});

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `token ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text,
  };
}

/** An installation token, as create-github-app-token gets one with the App's JWT. */
async function appToken(permissions?: Record<string, string>, repositories = ["app"]) {
  const jwt = appJwt(setup.codeman.clientId, setup.privateKey);
  const installation = await call("GET", "/api/v3/repos/acme/app/installation", jwt);
  assert.equal(installation.status, 200);
  assert.equal(installation.body.app_slug, "codeman");
  const created = await call(
    "POST",
    `/api/v3/app/installations/${installation.body.id}/access_tokens`,
    jwt,
    { repositories, ...(permissions ? { permissions } : {}) },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.token as string;
}

test("a call outside a token's permissions answers 403 as GitHub does", { skip }, async () => {
  const token = await appToken({ issues: "write", contents: "read" });
  const issue = await fake.act({
    action: "open-issue",
    as: "alice",
    repository: "acme/app",
    title: "Add a route",
  });
  assert.equal(
    (await call("GET", `/api/v3/repos/acme/app/issues/${issue.result}`, token)).status,
    200,
  );
  const pulls = await call("GET", "/api/v3/repos/acme/app/pulls", token);
  assert.equal(pulls.status, 403);
  assert.equal(pulls.body.message, "Resource not accessible by integration");
  assert.equal(pulls.body.status, "403");
  assert.match(pulls.body.documentation_url, /^https:\/\/docs\.github\.com\//);
  assert.equal(pulls.headers.get("x-accepted-github-permissions"), "pull_requests=read");
  // Without metadata: read, a collaborator's permission is out of reach, as the select job found.
  const permission = await call(
    "GET",
    "/api/v3/repos/acme/app/collaborators/alice/permission",
    token,
  );
  assert.equal(permission.status, 403);
  // A repository outside the token is not found; a write to the public one is forbidden.
  const site = await call("POST", "/api/v3/repos/acme/site/issues", token, { title: "x" });
  assert.equal(site.status, 403);
  assert.equal(fake.violations.length, 0);
});

test("reads follow GitHub's table: an issue needs issues, a pull request either", {
  skip,
}, async () => {
  const contents = await appToken({ contents: "write" });
  const pullsOnly = await appToken({ pull_requests: "write" });
  await fake.act({ action: "open-issue", as: "alice", repository: "acme/app", title: "Docs" });
  const branch = "codeman/docs";
  const main = await call("GET", "/api/v3/repos/acme/app/git/ref/heads/main", contents);
  assert.equal(main.status, 200);
  const created = await call("POST", "/api/v3/repos/acme/app/git/refs", contents, {
    ref: `refs/heads/${branch}`,
    sha: main.body.object.sha,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const blob = await call("POST", "/api/v3/repos/acme/app/git/blobs", contents, {
    content: "docs\n",
  });
  const tree = await call("POST", "/api/v3/repos/acme/app/git/trees", contents, {
    base_tree: main.body.object.sha,
    tree: [{ path: "DOCS.md", mode: "100644", type: "blob", sha: blob.body.sha }],
  });
  const commit = await call("POST", "/api/v3/repos/acme/app/git/commits", contents, {
    message: "Add docs",
    tree: tree.body.sha,
    parents: [main.body.object.sha],
  });
  await call("PATCH", `/api/v3/repos/acme/app/git/refs/heads/${branch}`, contents, {
    sha: commit.body.sha,
  });
  const pull = await call("POST", "/api/v3/repos/acme/app/pulls", pullsOnly, {
    title: "Add docs",
    head: branch,
    base: "main",
  });
  assert.equal(pull.status, 201, JSON.stringify(pull.body));
  const number = pull.body.number;
  // GET a pull request: Contents or Pull requests, at read.
  assert.equal((await call("GET", `/api/v3/repos/acme/app/pulls/${number}`, contents)).status, 200);
  assert.equal(
    (await call("GET", `/api/v3/repos/acme/app/pulls/${number}`, pullsOnly)).status,
    200,
  );
  // Listing pull requests and reading an issue have no alternative.
  assert.equal((await call("GET", "/api/v3/repos/acme/app/pulls", contents)).status, 403);
  const issue = await call("GET", `/api/v3/repos/acme/app/issues/${number}`, pullsOnly);
  assert.equal(issue.status, 403);
  assert.equal(issue.headers.get("x-accepted-github-permissions"), "issues=read");
  // An issue's labels take Pull requests on a pull request.
  assert.equal(
    (await call("GET", `/api/v3/repos/acme/app/issues/${number}/labels`, pullsOnly)).status,
    200,
  );
});

test("an installation token cannot ask for more than the installation has", { skip }, async () => {
  const jwt = appJwt(setup.codeman.clientId, setup.privateKey);
  const id = setup.installation.id;
  const tooMuch = await call("POST", `/api/v3/app/installations/${id}/access_tokens`, jwt, {
    permissions: { administration: "write" },
  });
  assert.equal(tooMuch.status, 422);
  assert.match(tooMuch.body.message, /not granted to this installation/);
  const elsewhere = await call("POST", `/api/v3/app/installations/${id}/access_tokens`, jwt, {
    repositories: ["other"],
  });
  assert.equal(elsewhere.status, 422);
  const all = await call("POST", `/api/v3/app/installations/${id}/access_tokens`, jwt, {});
  assert.equal(all.status, 201);
  assert.equal(all.body.permissions.workflows, "write");
  assert.deepEqual(
    all.body.repositories.map((repository: { full_name: string }) => repository.full_name),
    ["acme/app", "acme/site"],
  );
});

test("a token the fake did not give answers 401 and is a violation", { skip }, async () => {
  const unknown = await call("GET", "/api/v3/repos/acme/app", "ghp_developers_real_token");
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.message, "Bad credentials");
  const token = await appToken({ issues: "read" });
  assert.equal((await call("DELETE", "/api/v3/installation/token", token)).status, 204);
  assert.equal((await call("GET", "/api/v3/repos/acme/app/issues", token)).status, 401);
  const forged = appJwt(setup.codeman.clientId.replace(/.$/, "x"), setup.privateKey);
  assert.equal((await call("GET", "/api/v3/repos/acme/app/installation", forged)).status, 401);
  assert.deepEqual(
    fake.violations.map((violation) => [violation.kind, violation.path]),
    [
      ["unknown-token", "/api/v3/repos/acme/app"],
      ["revoked-token", "/api/v3/repos/acme/app/issues"],
      ["unknown-app", "/api/v3/repos/acme/app/installation"],
    ],
  );
  assert.ok(
    !JSON.stringify(fake.violations).includes("developers_real_token"),
    "tokens are masked",
  );
  const listed = await fetch(`${origin}/_fake/github/violations`, {
    headers: { authorization: "Bearer control" },
  });
  assert.equal(((await listed.json()) as unknown[]).length, 3);
});

test("a non-collaborator's command is visible, but its permission is not a maintainer's", {
  skip,
}, async () => {
  const site = await fake.act({
    action: "open-issue",
    as: "alice",
    repository: "acme/site",
    title: "Docs",
  });
  const comment = await fake.act({
    action: "comment",
    as: "stranger",
    repository: "acme/site",
    issue: Number(site.result),
    body: "/codeman decide 1a",
  });
  const [event] = comment.events;
  assert.ok(event);
  assert.equal(event.name, "issue_comment");
  assert.equal((event.payload.comment as { user: { type: string } }).user.type, "User");
  assert.equal((event.payload.sender as { login: string }).login, "stranger");
  assert.equal(event.triggers, true);
  const token = await appToken({ issues: "write", metadata: "read" }, ["site"]);
  const comments = await call(
    "GET",
    `/api/v3/repos/acme/site/issues/${site.result}/comments`,
    token,
  );
  assert.equal(comments.body[0].body, "/codeman decide 1a");
  const permission = async (repository: string, login: string, tokenFor = token) =>
    (await call("GET", `/api/v3/repos/${repository}/collaborators/${login}/permission`, tokenFor))
      .body;
  assert.deepEqual(
    [await permission("acme/site", "stranger"), await permission("acme/site", "alice")].map((p) => [
      p.permission,
      p.role_name,
    ]),
    [
      ["read", "read"],
      ["read", "read"],
    ],
  );
  const appTokenForApp = await appToken({ issues: "write", metadata: "read" });
  const roles = [];
  for (const login of ["olivia", "alice", "bob", "carol", "stranger"]) {
    const found = await permission("acme/app", login, appTokenForApp);
    roles.push([login, found.permission, found.role_name]);
  }
  assert.deepEqual(roles, [
    ["olivia", "admin", "admin"],
    ["alice", "write", "maintain"],
    ["bob", "read", "triage"],
    ["carol", "none", "none"],
    ["stranger", "none", "none"],
  ]);
  // On the private repository, a stranger cannot comment at all.
  const issue = await fake.act({
    action: "open-issue",
    as: "alice",
    repository: "acme/app",
    title: "Private",
  });
  await assert.rejects(
    fake.act({
      action: "comment",
      as: "stranger",
      repository: "acme/app",
      issue: Number(issue.result),
      body: "hi",
    }),
    /stranger may not comment/,
  );
  await assert.rejects(
    fake.act({
      action: "label",
      as: "carol",
      repository: "acme/app",
      issue: Number(issue.result),
      label: "codeman",
    }),
    /needs triage/,
  );
});

test("users' actions give the events a job reads at GITHUB_EVENT_PATH", { skip }, async () => {
  const seen: string[] = [];
  const stop = fake.onEvent((event) => {
    seen.push(`${event.name}.${String(event.payload.action ?? "")}`);
  });
  const opened = await fake.act({
    action: "open-issue",
    as: "alice",
    repository: "acme/app",
    title: "Task",
    labels: ["codeman"],
  });
  const [, labeled] = opened.events;
  assert.ok(labeled);
  assert.equal(labeled.name, "issues");
  assert.equal(labeled.payload.action, "labeled");
  assert.equal((labeled.payload.label as { name: string }).name, "codeman");
  assert.deepEqual(
    (labeled.payload.issue as { labels: { name: string }[] }).labels.map((l) => l.name),
    ["codeman"],
  );
  assert.equal((labeled.payload.repository as { default_branch: string }).default_branch, "main");
  assert.equal((labeled.payload.organization as { login: string }).login, "acme");
  // The App's own label is an event too, and GITHUB_TOKEN's starts no workflow.
  const token = await appToken({ issues: "write" });
  await call("POST", `/api/v3/repos/acme/app/issues/${opened.result}/labels`, token, {
    labels: ["codeman:planning"],
  });
  const job = fake.jobToken("acme/app", { issues: "write" });
  await call("POST", `/api/v3/repos/acme/app/issues/${opened.result}/comments`, job.value, {
    body: "From a job",
  });
  await fake.world.settled();
  const last = fake.events.slice(-2);
  assert.deepEqual(
    last.map((event) => [
      event.name,
      (event.payload.sender as { login: string; type: string }).login,
      event.triggers,
    ]),
    [
      ["issues", "codeman[bot]", true],
      ["issue_comment", "github-actions[bot]", false],
    ],
  );
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  assert.deepEqual(seen, [
    "issues.opened",
    "issues.labeled",
    "issues.labeled",
    "issue_comment.created",
  ]);
  const polled = await fetch(`${origin}/_fake/github/events?after=3&repository=acme/app`, {
    headers: { authorization: "Bearer control" },
  });
  assert.deepEqual(
    ((await polled.json()) as { id: number }[]).map((event) => event.id),
    [4],
  );
});

test("a dispatch is checked like GitHub's and reaches the runtime's callback", {
  skip,
}, async () => {
  const workflow = `name: Codeman
on:
  schedule:
    - cron: "0 9 * * *"
  workflow_dispatch:
    # A comment
    inputs:
      model:
        type: string
      batch:
        type: string
  issues:
    types: [labeled]
jobs: {}
`;
  await fake.act({
    action: "push",
    as: "olivia",
    repository: "acme/app",
    branch: "main",
    files: { ".github/workflows/codeman.yml": workflow },
  });
  const dispatched: [string, number][] = [];
  fake.onDispatch((dispatch, run) => {
    dispatched.push([dispatch.workflow, run.id]);
  });
  const token = await appToken({ actions: "write" });
  const path = "/api/v3/repos/acme/app/actions/workflows/codeman.yml/dispatches";
  const unexpected = await call("POST", path, token, { ref: "main", inputs: { modle: "x" } });
  assert.equal(unexpected.status, 422);
  assert.equal(unexpected.body.message, 'Unexpected inputs provided: ["modle"]');
  assert.equal(
    (await call("POST", path, token, { ref: "nope" })).body.message,
    "No ref found for: nope",
  );
  const ok = await call("POST", path, token, {
    ref: "main",
    inputs: { batch: "b1" },
    return_run_details: true,
  });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.workflow_run_id, "number");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched, [[".github/workflows/codeman.yml", ok.body.workflow_run_id]]);
  assert.deepEqual(fake.dispatches[0]?.inputs, { batch: "b1" });
  const event = fake.events.at(-1);
  assert.equal(event?.name, "workflow_dispatch");
  assert.deepEqual(event?.payload.inputs, { batch: "b1" });
  // A token without actions: write may not dispatch; gh resolves the workflow by name first.
  const reader = await appToken({ actions: "read" });
  assert.equal((await call("POST", path, reader, { ref: "main" })).status, 403);
  const listed = await call("GET", "/api/v3/repos/acme/app/actions/workflows", reader);
  assert.deepEqual(
    listed.body.workflows.map((w: { name: string; path: string }) => [w.name, w.path]),
    [["Codeman", ".github/workflows/codeman.yml"]],
  );
});

test("gh's default-branch query needs metadata: read", { skip }, async () => {
  const query = {
    query:
      "query RepositoryInfo($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id defaultBranchRef { name } } }",
    variables: { owner: "acme", name: "app" },
  };
  const without = await call("POST", "/api/graphql", await appToken({ actions: "write" }), query);
  assert.equal(without.status, 200);
  assert.equal(without.body.data.repository.defaultBranchRef, null);
  assert.deepEqual(without.body.errors, [
    {
      type: "FORBIDDEN",
      path: ["repository", "defaultBranchRef"],
      message: "Resource not accessible by integration",
    },
  ]);
  const withMetadata = await call(
    "POST",
    "/api/graphql",
    await appToken({ actions: "write", metadata: "read" }),
    query,
  );
  assert.deepEqual(withMetadata.body, {
    data: {
      repository: { ...withMetadata.body.data.repository, defaultBranchRef: { name: "main" } },
    },
  });
  const other = await call("POST", "/api/graphql", await appToken({ metadata: "read" }), {
    query: "{ viewer { login } }",
  });
  assert.ok(other.body.errors);
  assert.equal(fake.violations.at(-1)?.kind, "unsupported");
});

test("runs, jobs and concurrency groups read as the templates' gh calls read them", {
  skip,
}, async () => {
  const run = fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "schedule",
    status: "in_progress",
    concurrency: "codeman",
  });
  fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "workflow_dispatch",
    status: "pending",
    concurrency: "codeman",
  });
  const { job } = fake.startJob(run.id, "Select tasks");
  fake.finishJob(job.id, { conclusion: "success", log: "selected #1\n" });
  const token = await appToken({ actions: "read" });
  const group = await call(
    "GET",
    "/api/v3/repos/acme/app/actions/concurrency_groups/codeman",
    token,
  );
  assert.deepEqual(
    group.body.group_members.map((m: { status: string }) => m.status),
    ["in_progress", "pending"],
  );
  const jobs = await call("GET", `/api/v3/repos/acme/app/actions/runs/${run.id}/jobs`, token);
  assert.equal(jobs.body.jobs[0].conclusion, "success");
  assert.equal(
    (await call("GET", `/api/v3/repos/acme/app/actions/jobs/${job.id}/logs`, token)).body,
    "selected #1\n",
  );
  fake.updateRun(run.id, { status: "completed", conclusion: "success" });
  const after = await call(
    "GET",
    "/api/v3/repos/acme/app/actions/concurrency_groups/codeman",
    token,
  );
  assert.equal(after.body.total_count, 1);
});

test("the control API builds a world over HTTP and needs its token", { skip }, async () => {
  const control = (method: string, path: string, body?: unknown, token = "control") =>
    fetch(`${origin}/_fake/github${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await control("POST", "/users", { login: "dave" }, "wrong")).status, 401);
  assert.equal((await control("POST", "/users", { login: "dave" })).status, 201);
  const repository = await control("POST", "/repos", {
    owner: "dave",
    name: "tool",
    files: { "a.txt": "a\n" },
  });
  assert.equal(((await repository.json()) as { default_branch: string }).default_branch, "main");
  const token = (await (
    await control("POST", "/tokens", { repository: "dave/tool", permissions: { issues: "write" } })
  ).json()) as { token: string; permissions: Record<string, string> };
  assert.deepEqual(token.permissions, { issues: "write", metadata: "read" });
  const acted = await control("POST", "/act", {
    action: "open-issue",
    as: "dave",
    repository: "dave/tool",
    title: "T",
  });
  assert.equal(((await acted.json()) as { result: number }).result, 1);
  assert.equal(
    (await call("GET", "/api/v3/repos/dave/tool/issues/1", token.token)).body.title,
    "T",
  );
  assert.equal((await control("POST", "/repos", { owner: "dave" })).status, 400);
});
