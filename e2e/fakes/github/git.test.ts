import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { promisify } from "node:util";
import { hasGit } from "./git.ts";
import { GitHubFake } from "./github.ts";
import { acme } from "./testing.ts";
import { hasOpenssl, makeCertificates } from "./tls.ts";

const skip = !hasGit()
  ? "git is not on the PATH"
  : !hasOpenssl()
    ? "openssl is not on the PATH"
    : false;
const run = promisify(execFile);
// biome-ignore lint/suspicious/noExplicitAny: the bodies are the fake's, checked field by field.
type Body = any;
const scratch = mkdtempSync(join(tmpdir(), "codeman-e2e-github-git-"));
const fake = new GitHubFake();
let origin = "";
let ca = "";

before(async () => {
  if (skip) return;
  const certificates = makeCertificates(["localhost", "127.0.0.1"]);
  ca = join(scratch, "ca.crt");
  writeFileSync(ca, certificates.ca);
  origin = await fake.listen({ tls: certificates });
});
after(async () => {
  await fake.close();
  rmSync(scratch, { recursive: true, force: true });
});
beforeEach(async () => {
  if (skip) return;
  fake.server.reset();
  await acme(fake, { "README.md": "# App\n", "src/index.ts": "export {};\n" });
});

function installation() {
  const found = [...fake.world.installations.values()][0];
  assert.ok(found);
  return found;
}

/** The client's git: the test CA, no configuration of the machine, a token as checkout sends it. */
function git(args: string[], options: { cwd?: string; token?: string } = {}) {
  const auth = options.token
    ? [
        "-c",
        `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${options.token}`).toString("base64")}`,
      ]
    : [];
  return run("git", [...auth, ...args], {
    cwd: options.cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: scratch,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSL_CAINFO: ca,
      GIT_AUTHOR_NAME: "Alice",
      GIT_AUTHOR_EMAIL: "alice@example.com",
      GIT_COMMITTER_NAME: "Alice",
      GIT_COMMITTER_EMAIL: "alice@example.com",
    },
  });
}

/** A JSON call over HTTPS that trusts the test CA, as `NODE_EXTRA_CA_CERTS` makes Node do. */
function call(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: Body }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      `${origin}${path}`,
      {
        method,
        ca: readFileSync(ca),
        headers: { authorization: `token ${token}`, "content-type": "application/json" },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: incoming.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** A commit on `branch` through the Git Data API, as Codeman's platform makes one. */
async function dataApiCommit(
  token: string,
  branch: string,
  base: string,
  files: Record<string, string>,
  create = false,
) {
  const repo = "/api/v3/repos/acme/app";
  const commit = await call("GET", `${repo}/git/commits/${base}`, token);
  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await call("POST", `${repo}/git/blobs`, token, {
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
    });
    assert.equal(blob.status, 201);
    tree.push({ path, mode: "100644", type: "blob", sha: blob.body.sha });
  }
  const made = await call("POST", `${repo}/git/trees`, token, {
    base_tree: commit.body.tree.sha,
    tree,
  });
  const created = await call("POST", `${repo}/git/commits`, token, {
    message: "Add a route",
    tree: made.body.sha,
    parents: [base],
  });
  assert.equal(created.status, 201);
  const ref = create
    ? await call("POST", `${repo}/git/refs`, token, {
        ref: `refs/heads/${branch}`,
        sha: created.body.sha,
      })
    : await call("PATCH", `${repo}/git/refs/heads%2F${encodeURIComponent(branch)}`, token, {
        sha: created.body.sha,
        force: false,
      });
  return { sha: created.body.sha as string, ref };
}

test("git clone over HTTPS and a Data API commit land on the same bare repository", {
  skip,
}, async () => {
  const token = fake.world.installationToken(installation(), {}).value;
  const clone = join(scratch, "clone-1");
  await git(["clone", "--quiet", `${origin}/acme/app`, clone], { token });
  const head = (await git(["rev-parse", "HEAD"], { cwd: clone })).stdout.trim();
  const { sha, ref } = await dataApiCommit(
    token,
    "codeman/1",
    head,
    { "src/health.ts": "export const ok = true;\n" },
    true,
  );
  assert.equal(ref.status, 201);
  const commit = await call("GET", `/api/v3/repos/acme/app/git/commits/${sha}`, token);
  assert.equal(commit.body.verification.verified, true);
  assert.equal(commit.body.author.name, "codeman[bot]");
  await git(["fetch", "--quiet", "origin"], { cwd: clone, token });
  const fetched = (await git(["rev-parse", "origin/codeman/1"], { cwd: clone })).stdout.trim();
  assert.equal(fetched, sha);
  const shown = (await git(["show", `${sha}:src/health.ts`], { cwd: clone })).stdout;
  assert.equal(shown, "export const ok = true;\n");
  assert.equal((await git(["show", `${sha}:src/index.ts`], { cwd: clone })).stdout, "export {};\n");
  // A push over HTTPS is a push event, and the Data API reads what it pushed.
  writeFileSync(join(clone, "NOTES.md"), "notes\n");
  await git(["add", "NOTES.md"], { cwd: clone });
  await git(["commit", "--quiet", "-m", "Notes"], { cwd: clone });
  await git(["push", "--quiet", "origin", "HEAD:main"], { cwd: clone, token });
  const pushed = (await git(["rev-parse", "HEAD"], { cwd: clone })).stdout.trim();
  const main = await call("GET", "/api/v3/repos/acme/app/git/ref/heads/main", token);
  assert.equal(main.body.object.sha, pushed);
  const event = fake.events.at(-1);
  assert.equal(event?.name, "push");
  assert.equal(event?.payload.ref, "refs/heads/main");
  assert.equal(event?.payload.after, pushed);
  assert.equal(fake.violations.length, 0);
});

test("a moved branch refuses updateRef without force", { skip }, async () => {
  const token = fake.world.installationToken(installation(), {}).value;
  const main = await call("GET", "/api/v3/repos/acme/app/git/ref/heads%2Fmain", token);
  const base = main.body.object.sha as string;
  await dataApiCommit(token, "codeman/1", base, { "a.txt": "a\n" }, true);
  // Someone pushes to the task branch meanwhile.
  await fake.act({
    action: "push",
    as: "alice",
    repository: "acme/app",
    branch: "codeman/1",
    files: { "b.txt": "b\n" },
  });
  const stale = await dataApiCommit(token, "codeman/1", base, { "c.txt": "c\n" });
  assert.equal(stale.ref.status, 422);
  assert.equal(stale.ref.body.message, "Update is not a fast forward");
  const forced = await call("PATCH", "/api/v3/repos/acme/app/git/refs/heads/codeman/1", token, {
    sha: stale.sha,
    force: true,
  });
  assert.equal(forced.status, 200);
  const missing = await call("PATCH", "/api/v3/repos/acme/app/git/refs/heads/none", token, {
    sha: stale.sha,
  });
  assert.equal(missing.body.message, "Reference does not exist");
  const exists = await call("POST", "/api/v3/repos/acme/app/git/refs", token, {
    ref: "refs/heads/codeman/1",
    sha: base,
  });
  assert.equal(exists.body.message, "Reference already exists");
});

test("contents need their permissions, and a workflow change needs workflows: write", {
  skip,
}, async () => {
  const theInstallation = installation();
  const reader = fake.world.installationToken(theInstallation, {
    permissions: { contents: "read" },
  }).value;
  const writer = fake.world.installationToken(theInstallation, {
    permissions: { contents: "write" },
  }).value;
  const clone = join(scratch, "clone-2");
  await assert.rejects(
    git(["clone", "--quiet", `${origin}/acme/app.git`, clone]),
    /Authentication|could not read/,
  );
  await git(["clone", "--quiet", `${origin}/acme/app.git`, clone], { token: reader });
  writeFileSync(join(clone, "x.txt"), "x\n");
  await git(["add", "x.txt"], { cwd: clone });
  await git(["commit", "--quiet", "-m", "x"], { cwd: clone });
  await assert.rejects(
    git(["push", "--quiet", "origin", "HEAD:main"], { cwd: clone, token: reader }),
    /denied|403/,
  );
  await git(["push", "--quiet", "origin", "HEAD:main"], { cwd: clone, token: writer });
  await run("mkdir", ["-p", join(clone, ".github/workflows")]);
  writeFileSync(join(clone, ".github/workflows/ci.yml"), "on: push\n");
  await git(["add", "."], { cwd: clone });
  await git(["commit", "--quiet", "-m", "CI"], { cwd: clone });
  await assert.rejects(
    git(["push", "--quiet", "origin", "HEAD:main"], { cwd: clone, token: writer }),
    /refusing to allow a GitHub App to create or update workflow `\.github\/workflows\/ci\.yml` without `workflows` permission/,
  );
  const head = (await git(["rev-parse", "HEAD~1"], { cwd: clone })).stdout.trim();
  const viaApi = await dataApiCommit(
    writer,
    "codeman/2",
    head,
    { ".github/workflows/x.yml": "on: push\n" },
    true,
  );
  assert.equal(viaApi.ref.status, 403);
  assert.match(viaApi.ref.body.message, /without `workflows` permission/);
  // The public repository clones with no token at all; a private one's API is not found.
  await git(["clone", "--quiet", `${origin}/acme/site`, join(scratch, "clone-3")]);
  assert.equal(
    (await call("GET", "/api/v3/repos/acme/app/contents/README.md", "ghs_unknown")).status,
    401,
  );
});

test("a fixture directory becomes a repository whose first commit is the same each time", {
  skip,
}, async () => {
  const fixture = join(scratch, "fixture");
  await run("mkdir", ["-p", join(fixture, "src")]);
  writeFileSync(join(fixture, "package.json"), "{}\n");
  writeFileSync(join(fixture, "src/a.ts"), "export const a = 1;\n");
  const first = await fake.addRepository({ owner: "acme", name: "one", fixture });
  const second = await fake.addRepository({ owner: "acme", name: "two", fixture });
  const sha = async (repository: typeof first) => repository.git.resolve("refs/heads/main");
  assert.ok(await sha(first));
  assert.equal(await sha(first), await sha(second));
  const token = fake.jobToken("acme/one", { contents: "read" }).value;
  const content = await call("GET", "/api/v3/repos/acme/one/contents/src/a.ts?ref=main", token);
  assert.equal(
    Buffer.from(content.body.content, "base64").toString("utf8"),
    "export const a = 1;\n",
  );
  const tree = await call("GET", "/api/v3/repos/acme/one/git/trees/main?recursive=true", token);
  assert.deepEqual(
    tree.body.tree.map((entry: { path: string; type: string }) => `${entry.type} ${entry.path}`),
    ["blob package.json", "tree src", "blob src/a.ts"],
  );
  const compare = await call("GET", "/api/v3/repos/acme/one/compare/main...main", token);
  assert.equal(compare.body.status, "identical");
});
