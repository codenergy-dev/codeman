import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { GitHubFake } from "../../fakes/github/github.ts";
import type { RunIdentity } from "../../fakes/google/oidc.ts";
import { FakeClient } from "../fakes.ts";
import { RemoteGitHub } from "../github.ts";
import { fillCache } from "./cache.ts";
import { type ActCommand, ActRefused } from "./driver.ts";
import { parseActLog } from "./log.ts";
import { type ActOutcome, ActRunner, actConclusion, shownArgv } from "./runner.ts";

/**
 * The act runner against the fake GitHub in this process, with act replaced by a function that
 * reads the files and flags it was given and makes the requests a job would: no Docker.
 */

const skip = hasGit() ? false : "git is not on the PATH";
const TOKEN = "unit-control-token";
const SERVER = "https://github-e2e.localhost";

let fake: GitHubFake;
let client: FakeClient;
let github: RemoteGitHub;
let actionSha = "";
let actions = "";

before(async () => {
  if (skip) return;
  fake = new GitHubFake();
  client = new FakeClient("github", await fake.listen({ controlToken: TOKEN }), { token: TOKEN });
  github = new RemoteGitHub(client, { server: SERVER });
  // A pinned action's repository, and act's cache filled from it.
  const source = mkdtempSync(join(tmpdir(), "codeman-e2e-act-action-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@invalid", ...args], {
      cwd: source,
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  writeFileSync(join(source, "action.yml"), "runs: { using: node24, main: index.js }\n");
  git("add", ".");
  git("commit", "-qm", "action");
  actionSha = git("rev-parse", "HEAD");
  actions = mkdtempSync(join(tmpdir(), "codeman-e2e-act-actions-"));
  await fillCache(
    actions,
    [{ uses: `acme/hello@${actionSha}`, owner: "acme", repo: "hello", sha: actionSha }],
    { server: SERVER, sources: { "acme/hello": source } },
  );
});

after(async () => {
  if (!skip) await fake.close();
});

function workflows(sha: string): Record<string, string> {
  return {
    ".github/workflows/codeman.yml": `name: Codeman
on:
  workflow_dispatch:
  issues: { types: [labeled] }
permissions: {}
jobs:
  select:
    runs-on: ubuntu-latest
    permissions: { id-token: write, actions: read }
    steps:
      - uses: acme/hello@${sha}
  task:
    needs: select
    uses: ./.github/workflows/codeman-task.yml
`,
    ".github/workflows/codeman-task.yml": `on: workflow_call
jobs:
  agent:
    runs-on: ubuntu-latest
    permissions: { contents: read, actions: read }
    steps:
      - run: echo ok
  next:
    runs-on: ubuntu-latest
    permissions: { actions: write }
    steps:
      - run: echo ok
`,
  };
}

/** A world of one repository, on the reset fake. */
async function world(sha = actionSha) {
  await client.reset();
  github.forget();
  await github.addUser("alice");
  await github.addOrganization({ login: "acme", owners: ["alice"], members: [] });
  await github.addRepository({
    owner: "acme",
    name: "app",
    private: true,
    drafts: true,
    files: { "README.md": "app\n", ...workflows(sha) },
    collaborators: { alice: "maintain" },
  });
}

interface Seen {
  argv: string[];
  env: Record<string, string>;
  secrets: Record<string, string>;
  vars: Record<string, string>;
  event: Record<string, unknown>;
  workdir: string[];
  processEnv: Record<string, string>;
}

/** An act that records what it got, and calls the fake as a job's steps would, with each token. */
function fakeAct(seen: Seen[], options: { log?: string[]; exitCode?: number } = {}) {
  let running = 0;
  return async (command: ActCommand): Promise<ActOutcome> => {
    running++;
    assert.equal(running, 1, "one act invocation at a time");
    const flag = (name: string) => command.argv[command.argv.indexOf(name) + 1] ?? "";
    const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
    const token = (command.argv.find((arg) => arg.startsWith("GITHUB_TOKEN=")) ?? "").slice(13);
    const env = json(flag("--env-file"));
    seen.push({
      argv: command.argv,
      env: { ...env, GITHUB_TOKEN: token },
      secrets: json(flag("--secret-file")),
      vars: json(flag("--var-file")),
      event: json(flag("--eventpath")),
      workdir: readdirSync(command.cwd, { recursive: true }).map(String).sort(),
      processEnv: command.env,
    });
    // gh with GH_ENTERPRISE_TOKEN, an action with github.token: both are the fake's.
    for (const bearer of [token, env.GH_ENTERPRISE_TOKEN]) {
      await client.request("GET", "/api/v3/repos/acme/app", {
        headers: { authorization: `Bearer ${bearer}` },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    running--;
    return {
      exitCode: options.exitCode ?? 0,
      output: (
        options.log ?? [
          JSON.stringify({ level: "info", job: "Codeman/select  ", jobID: "select", msg: "hello" }),
          JSON.stringify({
            level: "info",
            job: "Codeman/select  ",
            jobID: "select",
            jobResult: "success",
            msg: "🏁  Job succeeded",
          }),
        ]
      ).join("\n"),
    };
  };
}

function runner(seen: Seen[], options: Parameters<typeof fakeAct>[1] = {}) {
  const identities: RunIdentity[] = [];
  const created = new ActRunner({
    github,
    oidc: {
      requestUrl: "http://google:8080/oidc/token?api-version=2.0",
      register: (identity) => {
        identities.push(identity);
        return `request-token-${identity.runId}`;
      },
    },
    secrets: () => ({ CODEMAN_GITHUB_APP_PRIVATE_KEY: "-----BEGIN-----\nkey\n-----END-----\n" }),
    vars: () => ({ CODEMAN_COMMIT_SHA: "a".repeat(40) }),
    act: "/usr/local/bin/act",
    image: "codeman-e2e-runner:local",
    network: "codeman-e2e-jobs",
    caVolume: "codeman-e2e-ca",
    env: { GH_HOST: "github-e2e.localhost" },
    labels: { "codeman-e2e.session": "unit" },
    workdir: mkdtempSync(join(tmpdir(), "codeman-e2e-act-runs-")),
    dockerHost: "unix:///var/run/docker.sock",
    state: {
      home: join(actions, "..", "home"),
      configHome: join(actions, "..", "config"),
      cacheHome: join(actions, "..", "cache"),
      tmp: join(actions, "..", "tmp"),
      actions,
    },
    prepare: { once: async () => undefined, each: async () => undefined },
    spawnAct: fakeAct(seen, options),
  });
  return { runner: created, identities };
}

function dispatch(id?: number) {
  return {
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "workflow_dispatch",
    inputs: { model: "m" },
    actor: "alice",
    ...(id ? { runId: id } : {}),
    payload: { inputs: { model: "m" }, ref: "refs/heads/main", sender: { login: "alice" } },
  };
}

test("each invocation runs alone, with its own run ID, tokens and files, all the fake's", {
  skip,
}, async () => {
  await world();
  const seen: Seen[] = [];
  const { runner: act, identities } = runner(seen);
  const runs = await Promise.all([act.start(dispatch()), act.start(dispatch())]);
  const results = await Promise.all(runs.map((run) => run.finished));
  assert.deepEqual(
    results.map((result) => result.conclusion),
    ["success", "success"],
  );
  assert.equal(seen.length, 2);
  const [first, second] = seen as [Seen, Seen];
  const env = (one: Seen, name: string) =>
    one.argv.flatMap((arg, index) =>
      one.argv[index - 1] === "--env" && arg.startsWith(`${name}=`)
        ? [arg.slice(name.length + 1)]
        : [],
    )[0];
  // In either order, but each with its own run's ID.
  const ids = runs.map((run) => String(run.id)).sort();
  assert.deepEqual(seen.map((one) => env(one, "GITHUB_RUN_ID")).sort(), ids);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(env(first, "RUNNER_TEMP"), "/tmp");
  assert.equal(env(first, "GITHUB_SERVER_URL"), SERVER);
  assert.equal(env(first, "ACTIONS_RESULTS_URL"), `${SERVER}/`);
  assert.equal(
    env(first, "ACTIONS_ID_TOKEN_REQUEST_URL"),
    "http://google:8080/oidc/token?api-version=2.0",
  );
  assert.equal(env(first, "GH_HOST"), "github-e2e.localhost");

  // The token act gives every job, gh's copy, the runtime and OIDC request tokens: per invocation.
  for (const one of seen) {
    assert.match(one.env.GITHUB_TOKEN ?? "", /^ghs_/);
    assert.equal(one.env.GH_ENTERPRISE_TOKEN, one.env.GITHUB_TOKEN);
    assert.ok(one.env.ACTIONS_RUNTIME_TOKEN);
  }
  assert.notEqual(first.env.GITHUB_TOKEN, second.env.GITHUB_TOKEN);
  assert.notEqual(first.env.ACTIONS_RUNTIME_TOKEN, second.env.ACTIONS_RUNTIME_TOKEN);
  for (const one of seen) {
    assert.equal(
      one.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      `request-token-${env(one, "GITHUB_RUN_ID")}`,
    );
  }
  assert.deepEqual(
    identities
      .map((identity) => [identity.runId, identity.workflowFile, identity.repository])
      .sort(),
    ids.map((id) => [id, "codeman.yml", "acme/app"]),
  );

  // The working directory held the workflows only; the secrets, variables and event were given.
  assert.deepEqual(first.workdir, [
    ".github",
    ".github/workflows",
    ".github/workflows/codeman-task.yml",
    ".github/workflows/codeman.yml",
  ]);
  assert.equal(
    first.secrets.CODEMAN_GITHUB_APP_PRIVATE_KEY,
    "-----BEGIN-----\nkey\n-----END-----\n",
  );
  assert.equal(first.secrets.GITHUB_TOKEN, undefined);
  assert.equal(first.vars.CODEMAN_COMMIT_SHA, "a".repeat(40));
  assert.deepEqual(first.event.inputs, { model: "m" });
  assert.equal((first.event.repository as { full_name?: string }).full_name, "acme/app");

  // The fake saw no token it did not give, and each token has the union of the jobs' permissions.
  assert.deepEqual(await github.violations(), []);
  const tokens = await client.json<{ job?: string; scopes?: string[] }[]>("GET", "/github/tokens");
  const mine = tokens.filter((token) => token.job === "act");
  assert.equal(mine.length, 2);
  for (const token of mine) {
    assert.deepEqual(token.scopes, ["actions=write", "contents=read", "metadata=read"]);
  }

  // And the check is live: a token the fake never gave is a violation.
  await client.request("GET", "/api/v3/repos/acme/app", {
    headers: { authorization: "Bearer ghp_the_developers_own" },
    ok: () => true,
  });
  assert.equal((await github.violations()).length, 1);
});

test("act's log gives each job's result; a stop at act's matrix limit with no job is a skipped run", {
  skip,
}, async () => {
  await world();
  const matrix = [
    JSON.stringify({
      level: "error",
      msg: "Error while evaluating matrix: Invalid JSON: unexpected end of JSON input",
    }),
    JSON.stringify({
      level: "fatal",
      msg: "Failed to decode node {…} into *map[string][]interface {}",
    }),
  ];
  const seen: Seen[] = [];
  const { runner: act } = runner(seen, { log: matrix, exitCode: 1 });
  const result = await (await act.start(dispatch())).finished;
  assert.equal(result.conclusion, "skipped");
  assert.match(result.error ?? "", /act exited with 1: Error while evaluating matrix/);
});

test("a pin missing from act's cache stops the run before act starts", { skip }, async () => {
  await world("b".repeat(40));
  const seen: Seen[] = [];
  const { runner: act } = runner(seen);
  const run = await act.start(dispatch());
  await assert.rejects(run.finished, (error: unknown) => {
    assert.ok(error instanceof ActRefused);
    assert.match(error.message, /lacks pinned actions .*acme\/hello@b{40} is not in the cache/);
    assert.match(error.message, /node e2e\/runtime\/act\/fill-cache\.ts/);
    return true;
  });
  assert.equal(seen.length, 0);
});

test("a run's conclusion follows GitHub's from act's exit code, results and errors", () => {
  const conclude = (
    exitCode: number,
    results: ("success" | "failure" | "skipped")[],
    errors: string[] = [],
  ) => actConclusion({ exitCode, cancelled: false, results, errors });
  assert.deepEqual(conclude(0, ["success", "skipped"]), { conclusion: "success" });
  assert.equal(conclude(1, ["success", "failure"]).conclusion, "failure");
  // Jobs ran, then act stopped at a later stage's matrix: act's exit code stands.
  assert.equal(
    conclude(1, ["success"], ["Error while evaluating matrix: x"]).conclusion,
    "failure",
  );
  assert.equal(conclude(1, [], ["Error while evaluating matrix: x"]).conclusion, "skipped");
  assert.equal(
    conclude(1, [], ["Cannot connect to the Docker daemon"]).conclusion,
    "startup_failure",
  );
  assert.equal(conclude(0, []).conclusion, "skipped");
  assert.equal(
    actConclusion({ exitCode: 1, cancelled: true, results: ["success"], errors: [] }).conclusion,
    "cancelled",
  );
});

test("act's JSON log is split by job, names trimmed, and the token is masked in the command", () => {
  const log = parseActLog(
    [
      "Using docker host 'unix:///var/run/docker.sock'",
      JSON.stringify({
        level: "info",
        job: "#1/Codeman task/Open key  ",
        jobID: "open-key",
        step: "Main",
        msg: "opening",
      }),
      JSON.stringify({
        level: "info",
        job: "#1/Codeman task/Open key  ",
        jobID: "open-key",
        jobResult: "failure",
        msg: "🏁  Job failed",
      }),
      JSON.stringify({ level: "info", job: "Codeman/Next run", jobID: "next-run", msg: "started" }),
      JSON.stringify({ level: "error", msg: "Job 'Open key' failed" }),
    ].join("\n"),
  );
  assert.deepEqual(
    log.jobs.map((job) => [job.id, job.name, job.result]),
    [
      ["open-key", "#1/Codeman task/Open key", "failure"],
      // A job with lines but no result did not end.
      ["next-run", "Codeman/Next run", "cancelled"],
    ],
  );
  assert.equal(log.jobs[0]?.log, "[Main] opening\n🏁  Job failed");
  assert.deepEqual(log.errors, ["Job 'Open key' failed"]);
  assert.match(log.unattributed, /Using docker host/);
  assert.deepEqual(shownArgv(["--secret", "GITHUB_TOKEN=ghs_x", "--env", "A=b"]), [
    "--secret",
    "GITHUB_TOKEN=***",
    "--env",
    "A=b",
  ]);
});
