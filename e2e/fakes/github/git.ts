import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Bare repositories on disk, driven by the `git` command: the plumbing behind the fake's Git Data
 * API, and `git http-backend` for clones, fetches and pushes. Git runs without the system's or the
 * user's configuration, so no signing, hook or alias of the developer's machine applies.
 */

export const ZERO_SHA = "0000000000000000000000000000000000000000";

/** The environment of every git command: no configuration but the repository's own. */
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

export class GitError extends Error {
  readonly code: number | null;
  readonly stderr: string;

  constructor(args: readonly string[], code: number | null, stderr: string) {
    super(`git ${args.join(" ")} exited with ${code}: ${stderr.trim()}`);
    this.code = code;
    this.stderr = stderr;
  }
}

/** Whether a usable `git` is on the PATH. */
export function hasGit(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}

export interface Identity {
  name: string;
  email: string;
  /** ISO 8601. */
  date: string;
}

export interface CommitObject {
  sha: string;
  tree: string;
  parents: string[];
  author: Identity;
  committer: Identity;
  message: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  /** Blobs only. */
  size?: number;
}

/** An entry for `buildTree`: a blob by SHA or content, a tree by SHA, or a deletion. */
export interface TreeChange {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  /** Null deletes the path. */
  sha?: string | null;
  content?: Buffer;
}

/**
 * The pre-receive hook of every bare repository: a push that changes a workflow file needs the
 * `workflows` permission, which the fake passes in `FAKE_GITHUB_WORKFLOWS`, as GitHub refuses
 * such a push from an App's token that lacks it.
 */
const PRE_RECEIVE = `#!/bin/sh
[ "$FAKE_GITHUB_WORKFLOWS" = write ] && exit 0
zero=${ZERO_SHA}
while read -r old new ref; do
  [ "$new" = "$zero" ] && continue
  if [ "$old" = "$zero" ]; then
    files=$(git log --format= --name-only "$new" --not --all -- .github/workflows)
  else
    files=$(git diff --name-only "$old" "$new" -- .github/workflows)
  fi
  if [ -n "$files" ]; then
    first=$(printf '%s\\n' "$files" | head -n 1)
    echo "refusing to allow a GitHub App to create or update workflow \\\`$first\\\` without \\\`workflows\\\` permission" >&2
    exit 1
  fi
done
exit 0
`;

export class BareRepository {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** A new, empty bare repository whose HEAD is `branch`. */
  static async init(path: string, branch: string): Promise<BareRepository> {
    mkdirSync(path, { recursive: true });
    const repository = new BareRepository(path);
    await repository.run(["init", "--bare", "--quiet", `--initial-branch=${branch}`, path]);
    await repository.run(["config", "uploadpack.allowAnySHA1InWant", "true"]);
    await repository.run(["config", "http.receivepack", "true"]);
    const hook = join(path, "hooks", "pre-receive");
    writeFileSync(hook, PRE_RECEIVE);
    chmodSync(hook, 0o755);
    return repository;
  }

  /** A bare copy of another repository, with its branches and tags. */
  static async clone(source: string, path: string): Promise<BareRepository> {
    await run(["clone", "--bare", "--quiet", "--no-hardlinks", source, path]);
    const repository = new BareRepository(path);
    await repository.run(["config", "uploadpack.allowAnySHA1InWant", "true"]);
    await repository.run(["config", "http.receivepack", "true"]);
    await repository.run(["remote", "remove", "origin"]).catch(() => undefined);
    const hook = join(path, "hooks", "pre-receive");
    writeFileSync(hook, PRE_RECEIVE);
    chmodSync(hook, 0o755);
    return repository;
  }

  run(args: readonly string[], options: RunOptions = {}): Promise<Buffer> {
    return run(["--git-dir", this.path, ...args], options);
  }

  async text(args: readonly string[], options: RunOptions = {}): Promise<string> {
    return (await this.run(args, options)).toString("utf8").trim();
  }

  /** The commit a revision names, or undefined. */
  async resolve(revision: string): Promise<string | undefined> {
    if (revision.startsWith("-")) return undefined;
    try {
      return await this.text(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]);
    } catch {
      return undefined;
    }
  }

  /** The tree a revision or tree SHA names, or undefined. */
  async resolveTree(revision: string): Promise<string | undefined> {
    if (revision.startsWith("-")) return undefined;
    try {
      return await this.text(["rev-parse", "--verify", "--quiet", `${revision}^{tree}`]);
    } catch {
      return undefined;
    }
  }

  async objectType(sha: string): Promise<string | undefined> {
    if (!/^[0-9a-f]{4,64}$/.test(sha)) return undefined;
    try {
      return await this.text(["cat-file", "-t", sha]);
    } catch {
      return undefined;
    }
  }

  async writeBlob(content: Buffer): Promise<string> {
    return this.text(["hash-object", "-w", "--stdin"], { input: content });
  }

  readBlob(sha: string): Promise<Buffer> {
    return this.run(["cat-file", "blob", sha]);
  }

  /**
   * A tree from `base` (none: an empty one) with `changes` applied, through an index of its own.
   * Paths may be nested; a missing directory is made.
   */
  async buildTree(base: string | undefined, changes: readonly TreeChange[]): Promise<string> {
    const index = join(tmpdir(), `codeman-e2e-index-${randomUUID()}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.run(base ? ["read-tree", base] : ["read-tree", "--empty"], { env });
      const lines: string[] = [];
      const trees: TreeChange[] = [];
      for (const change of changes) {
        if (change.sha === null) {
          for (const path of await this.#indexed(change.path, env)) {
            lines.push(`0 ${ZERO_SHA}\t${path}`);
          }
        } else if (change.type === "tree") {
          for (const path of await this.#indexed(change.path, env)) {
            lines.push(`0 ${ZERO_SHA}\t${path}`);
          }
          trees.push(change);
        } else {
          const sha = change.content ? await this.writeBlob(change.content) : change.sha;
          if (!sha) throw new Error(`The tree entry ${change.path} has neither sha nor content.`);
          lines.push(`${change.mode} ${sha}\t${change.path}`);
        }
      }
      if (lines.length > 0) {
        await this.run(["update-index", "--add", "--replace", "--index-info"], {
          env,
          input: `${lines.join("\n")}\n`,
        });
      }
      for (const tree of trees) {
        await this.run(["read-tree", `--prefix=${tree.path}/`, tree.sha ?? ""], { env });
      }
      return await this.text(["write-tree"], { env });
    } finally {
      rmSync(index, { force: true });
    }
  }

  /** The indexed paths at `path` or under it. */
  async #indexed(path: string, env: Record<string, string>): Promise<string[]> {
    const out = await this.run(["ls-files", "-z", "--", path], { env });
    return out
      .toString("utf8")
      .split("\0")
      .filter((file) => file === path || file.startsWith(`${path}/`));
  }

  async listTree(tree: string, recursive: boolean): Promise<TreeEntry[]> {
    const args = ["ls-tree", "-l", "-z", ...(recursive ? ["-r", "-t"] : []), tree];
    const out = (await this.run(args)).toString("utf8");
    const entries: TreeEntry[] = [];
    for (const line of out.split("\0")) {
      const match = /^(\d+) (\w+) ([0-9a-f]+) +(\S+)\t(.*)$/s.exec(line);
      if (!match) continue;
      const [, mode = "", type, sha = "", size, path = ""] = match;
      entries.push({
        path,
        mode,
        type: type as TreeEntry["type"],
        sha,
        ...(type === "blob" ? { size: Number(size) } : {}),
      });
    }
    return entries;
  }

  /** The entry at `path` in a revision, or undefined. */
  async entry(revision: string, path: string): Promise<TreeEntry | undefined> {
    if (path === "") return undefined;
    const tree = await this.resolveTree(revision);
    if (!tree) return undefined;
    const out = (await this.run(["ls-tree", "-l", "-z", tree, "--", path])).toString("utf8");
    const match = /^(\d+) (\w+) ([0-9a-f]+) +(\S+)\t(.*)$/s.exec(out.split("\0")[0] ?? "");
    if (!match || match[5] !== path) return undefined;
    const [, mode = "", type, sha = "", size] = match;
    return {
      path,
      mode,
      type: type as TreeEntry["type"],
      sha,
      ...(type === "blob" ? { size: Number(size) } : {}),
    };
  }

  async commitTree(options: {
    tree: string;
    parents: readonly string[];
    message: string;
    author: Identity;
    committer: Identity;
  }): Promise<string> {
    const args = ["commit-tree", options.tree, ...options.parents.flatMap((p) => ["-p", p])];
    return this.text([...args, "-F", "-"], {
      input: options.message,
      env: {
        GIT_AUTHOR_NAME: options.author.name,
        GIT_AUTHOR_EMAIL: options.author.email,
        GIT_AUTHOR_DATE: options.author.date,
        GIT_COMMITTER_NAME: options.committer.name,
        GIT_COMMITTER_EMAIL: options.committer.email,
        GIT_COMMITTER_DATE: options.committer.date,
      },
    });
  }

  async readCommit(sha: string): Promise<CommitObject | undefined> {
    if ((await this.objectType(sha)) !== "commit") return undefined;
    const full = await this.text(["rev-parse", sha]);
    const raw = (await this.run(["cat-file", "commit", full])).toString("utf8");
    const split = raw.indexOf("\n\n");
    const headers = (split < 0 ? raw : raw.slice(0, split)).split("\n");
    const commit: CommitObject = {
      sha: full,
      tree: "",
      parents: [],
      author: { name: "", email: "", date: "" },
      committer: { name: "", email: "", date: "" },
      message: split < 0 ? "" : raw.slice(split + 2),
    };
    for (const header of headers) {
      const [key = "", ...rest] = header.split(" ");
      const value = rest.join(" ");
      if (key === "tree") commit.tree = value;
      else if (key === "parent") commit.parents.push(value);
      else if (key === "author") commit.author = identity(value);
      else if (key === "committer") commit.committer = identity(value);
    }
    return commit;
  }

  /** Each ref's SHA, by full name. */
  async refs(): Promise<Map<string, string>> {
    const out = await this.text(["for-each-ref", "--format=%(objectname) %(refname)"]);
    const refs = new Map<string, string>();
    for (const line of out.split("\n")) {
      const [sha, name] = line.split(" ");
      if (sha && name) refs.set(name, sha);
    }
    return refs;
  }

  /** Sets `ref` to `sha` if it still points at `old` (`ZERO_SHA`: if it does not exist). */
  async updateRef(ref: string, sha: string, old?: string): Promise<boolean> {
    try {
      await this.run(["update-ref", ref, sha, ...(old ? [old] : [])]);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }

  async deleteRef(ref: string, old?: string): Promise<boolean> {
    try {
      await this.run(["update-ref", "-d", ref, ...(old ? [old] : [])]);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.run(["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch (error) {
      if (error instanceof GitError && error.code === 1) return false;
      throw error;
    }
  }

  async mergeBase(a: string, b: string): Promise<string | undefined> {
    try {
      return await this.text(["merge-base", a, b]);
    } catch {
      return undefined;
    }
  }

  async count(range: string): Promise<number> {
    return Number(await this.text(["rev-list", "--count", range]));
  }

  /** Commits from `revision` back, newest first, as `git log` filters them. */
  async log(
    revision: string,
    options: { until?: string; since?: string; path?: string; max?: number; skip?: number } = {},
  ): Promise<CommitObject[]> {
    const args = ["log", "--format=%H", "--date-order"];
    if (options.until) args.push(`--until=${options.until}`);
    if (options.since) args.push(`--since=${options.since}`);
    if (options.max !== undefined) args.push(`--max-count=${options.max}`);
    if (options.skip) args.push(`--skip=${options.skip}`);
    args.push(revision, "--");
    if (options.path) args.push(options.path);
    const shas = (await this.text(args)).split("\n").filter((sha) => sha !== "");
    const commits: CommitObject[] = [];
    for (const sha of shas) {
      const commit = await this.readCommit(sha);
      if (commit) commits.push(commit);
    }
    return commits;
  }

  /** The files changed from `a` to `b`, with their status letter (`A`, `M`, `D`). */
  async diff(a: string, b: string): Promise<{ status: string; path: string }[]> {
    const out = (await this.run(["diff", "--name-status", "--no-renames", "-z", a, b])).toString(
      "utf8",
    );
    const parts = out.split("\0").filter((part) => part !== "");
    const files: { status: string; path: string }[] = [];
    for (let index = 0; index + 1 < parts.length; index += 2) {
      files.push({ status: parts[index] ?? "", path: parts[index + 1] ?? "" });
    }
    return files;
  }
}

export interface RunOptions {
  input?: Buffer | string;
  env?: Record<string, string>;
  cwd?: string;
}

/** Runs git; throws a `GitError` on a non-zero exit. */
export function run(args: readonly string[], options: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), ...GIT_ENV, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new GitError(args, code, Buffer.concat(err).toString("utf8")));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

/** `Name <email> 1760000000 +0000` as an identity with an ISO date. */
function identity(value: string): Identity {
  const match = /^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/.exec(value);
  if (!match) return { name: value, email: "", date: "" };
  const [, name = "", email = "", seconds = "0"] = match;
  return { name, email, date: new Date(Number(seconds) * 1000).toISOString().replace(".000", "") };
}

export interface BackendRequest {
  method: string;
  /** Such as `/acme/app.git/info/refs`, under `root`. */
  pathInfo: string;
  query: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** The authenticated user; enables pushes. */
  remoteUser?: string;
  /** Passed to the repository's hooks, such as `FAKE_GITHUB_WORKFLOWS`. */
  env?: Record<string, string>;
  /** Runs once git is done, before the answer ends, so the client sees what it records. */
  done?: () => Promise<void>;
}

/** Answers a smart HTTP request with `git http-backend`, a CGI program, from `root`. */
export function httpBackend(
  root: string,
  request: BackendRequest,
  response: ServerResponse,
): Promise<void> {
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value.join(", ") : (value ?? "");
  };
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: tmpdir(),
    ...GIT_ENV,
    ...request.env,
    GIT_PROJECT_ROOT: root,
    GIT_HTTP_EXPORT_ALL: "1",
    GATEWAY_INTERFACE: "CGI/1.1",
    REQUEST_METHOD: request.method,
    PATH_INFO: request.pathInfo,
    QUERY_STRING: request.query.replace(/^\?/, ""),
    CONTENT_TYPE: header("content-type"),
    CONTENT_LENGTH: String(request.body.length),
    REMOTE_ADDR: "127.0.0.1",
  };
  if (request.remoteUser) env.REMOTE_USER = request.remoteUser;
  if (header("content-encoding")) env.HTTP_CONTENT_ENCODING = header("content-encoding");
  if (header("git-protocol")) env.GIT_PROTOCOL = header("git-protocol");
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["http-backend"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let head = Buffer.alloc(0);
    let started = false;
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.on("data", (chunk: Buffer) => {
      if (started) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = headerEnd(head);
      if (!end) return;
      started = true;
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head.subarray(0, end.at).toString("latin1").split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (name === "status") status = Number.parseInt(value, 10) || 200;
        else headers[name] = value;
      }
      response.writeHead(status, headers);
      const rest = head.subarray(end.at + end.length);
      if (rest.length > 0) response.write(rest);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!started) {
        response
          .writeHead(500, { "content-type": "text/plain" })
          .end(`git http-backend exited with ${code}: ${Buffer.concat(stderr).toString("utf8")}`);
        resolve();
        return;
      }
      (request.done ?? (async () => undefined))()
        .catch(() => undefined)
        .finally(() => {
          response.end();
          resolve();
        });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(request.body);
  });
}

function headerEnd(buffer: Buffer): { at: number; length: number } | undefined {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { at: crlf, length: 4 };
  if (lf >= 0) return { at: lf, length: 2 };
  return undefined;
}
