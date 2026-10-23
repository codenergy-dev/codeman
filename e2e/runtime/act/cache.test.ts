import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { cacheName, cacheProblems, cleanGit, fillCache, pinnedActions } from "./cache.ts";

const skip = hasGit() ? false : "git is not on the PATH";
const SERVER = "https://github-e2e.localhost";

/** A local repository with one commit, standing for an action's repository; its commit's SHA. */
function actionRepository(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "codeman-e2e-action-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@invalid", ...args], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "action.yml"), "runs: { using: node24, main: index.js }\n");
  git("add", "action.yml");
  git("commit", "-qm", "action");
  return { dir, sha: git("rev-parse", "HEAD") };
}

test("the pinned actions are the remote uses: of the workflows, each once", () => {
  const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
  const workflows = {
    "codeman.yml": `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${sha} # v7.0.1\n      - uses: ./.codeman/action\n`,
    "task.yml": `jobs:\n  b:\n    steps:\n      - uses: "actions/checkout@${sha}"\n      - uses: docker://alpine:3\n      - uses: owner/repo/sub@${sha}\n`,
  };
  assert.deepEqual(pinnedActions(workflows), [
    { uses: `actions/checkout@${sha}`, owner: "actions", repo: "checkout", sha },
    { uses: `owner/repo/sub@${sha}`, owner: "owner", repo: "repo", sha },
  ]);
  assert.equal(cacheName(`actions/checkout@${sha}`), `actions-checkout@${sha}`);
  assert.throws(
    () => pinnedActions({ "x.yml": "      - uses: actions/checkout@v4\n" }),
    /x\.yml: actions\/checkout@v4 is not pinned to a full commit SHA/,
  );
});

test("the cache is filled from a local clone, checked at its pin, with the origin act requires", {
  skip,
}, async () => {
  const source = actionRepository();
  const cache = mkdtempSync(join(tmpdir(), "codeman-e2e-act-cache-"));
  const action = {
    uses: `acme/hello@${source.sha}`,
    owner: "acme",
    repo: "hello",
    sha: source.sha,
  };
  assert.deepEqual(await cacheProblems(cache, [action], SERVER), [
    `acme/hello@${source.sha} is not in the cache (${join(cache, `acme-hello@${source.sha}`)})`,
  ]);
  await fillCache(cache, [action], { server: SERVER, sources: { "acme/hello": source.dir } });
  assert.deepEqual(await cacheProblems(cache, [action], SERVER), []);
  const clone = join(cache, `acme-hello@${source.sha}`);
  assert.equal((await cleanGit(["-C", clone, "rev-parse", "HEAD"])).trim(), source.sha);

  // act deletes and clones again a cached action whose origin is not the server's.
  await cleanGit(["-C", clone, "remote", "set-url", "origin", "https://github.com/acme/hello"]);
  const [problem] = await cacheProblems(cache, [action], SERVER);
  assert.match(
    problem ?? "",
    /has the origin https:\/\/github\.com\/acme\/hello, not https:\/\/github-e2e\.localhost\/acme\/hello/,
  );

  const missing = { ...action, uses: `acme/hello@${"0".repeat(40)}`, sha: "0".repeat(40) };
  await assert.rejects(
    fillCache(cache, [missing], { server: SERVER, sources: { "acme/hello": source.dir } }),
    /has no commit 0{40}/,
  );
});
