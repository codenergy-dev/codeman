import { lstatSync, mkdirSync, rmSync, type Stats } from "node:fs";
import { join } from "node:path";
import { sudo, sudoCapture } from "./sandbox.ts";

export interface Change {
  path: string;
  status: "added" | "modified" | "deleted";
  type?: "file" | "symlink" | "other";
  mode?: "100644" | "100755";
  size?: number;
}

/** What the agent job hands to the apply job, next to `tree/` (changed files) and `output.json`. */
export interface Manifest {
  version: 1;
  harness: string;
  exitCode: number | null;
  timedOut: boolean;
  /** How long the harness ran, measured outside the sandbox. */
  durationMs?: number;
  changes: Change[];
}

/**
 * Parses `git status --porcelain=v1 -z --no-renames`, comparing the work tree with the checkout.
 * Git lists an embedded repository (a directory with its own `.git`) as one entry ending in
 * `/`, without looking inside: it is returned without the slash, as `type: "other"`.
 */
export function parseStatus(output: string): Pick<Change, "path" | "status" | "type">[] {
  const changes: Pick<Change, "path" | "status" | "type">[] = [];
  for (const entry of output.split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3).replace(/\/+$/, "");
    const status =
      code === "??"
        ? "added"
        : code[1] === "D"
          ? "deleted"
          : code[1] === "M" || code[1] === "T"
            ? "modified"
            : undefined;
    if (!status || path === "") continue;
    changes.push(entry.endsWith("/") ? { path, status, type: "other" } : { path, status });
  }
  return changes;
}

/**
 * The `git status` that lists the agent's changes: the trusted `.git` against the agent's work
 * tree, with only trusted configuration. Git does not enter submodules, whose repositories and
 * configuration the agent controls; Codeman never commits a submodule change anyway.
 */
export function statusCommand(gitDir: string, worktree: string): string[] {
  return [
    "git",
    "--no-optional-locks",
    "-c",
    "safe.directory=*",
    "-c",
    "core.fsmonitor=false",
    `--git-dir=${gitDir}`,
    `--work-tree=${worktree}`,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
    "--no-renames",
  ];
}

/**
 * Lists what the agent changed and copies the changed files into `outDir/tree`.
 *
 * The agent controls its copy of the repository, including `.git`, so git runs with the
 * original checkout's `.git` (trusted) against the agent's work tree. Only regular files are
 * copied; symlinks, directories (embedded repositories) and special files are listed in the
 * manifest as changed, but not copied. A path that cannot be copied is listed the same way, so
 * one path never costs the run its result. Submodules are not listed.
 */
export function collectChanges(options: {
  gitDir: string;
  worktree: string;
  outDir: string;
  exclude: readonly string[];
}): Change[] {
  // The agent owns its home, so the work tree may be a symlink it put there to send root out of
  // the sandbox. `sealAgentSandbox` has taken the paths away from the agent; refuse one anyway.
  requireRealDirectory(options.worktree);

  const status = sudo(statusCommand(options.gitDir, options.worktree));
  const changes = parseStatus(status).filter(
    ({ path }) =>
      !options.exclude.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );

  const tree = join(options.outDir, "tree");
  mkdirSync(tree, { recursive: true });
  // Classify before copying: only regular files are copied. A symlink, a FIFO or any other
  // special file is listed but never opened, so `cp` cannot follow it out or block on a pipe.
  const candidates = changes.filter(
    (change) => change.status !== "deleted" && change.type === undefined,
  );
  const kinds = classifyPaths(
    options.worktree,
    candidates.map(({ path }) => path),
  );
  const copies = candidates
    .filter(({ path }) => kinds.get(path) === "file")
    .map(({ path }) => path);
  const failed = copyPaths(options.worktree, tree, copies);
  if (copies.length > 0) {
    sudo(["chown", "-R", `${process.getuid?.()}:${process.getgid?.()}`, tree]);
  }

  return changes.map((change): Change => {
    if (change.status === "deleted" || change.type !== undefined) return change;
    if (kinds.get(change.path) !== "file" || failed.has(change.path)) {
      return { ...change, type: kinds.get(change.path) === "symlink" ? "symlink" : "other" };
    }
    const copy = join(tree, change.path);
    const stats = lstatOrUndefined(copy);
    if (!stats?.isFile()) {
      // Keep only the fact that it changed: the artifact upload would follow a symlink.
      rmSync(copy, { recursive: true, force: true });
      return { ...change, type: stats?.isSymbolicLink() ? "symlink" : "other" };
    }
    return {
      ...change,
      type: "file",
      mode: stats.mode & 0o111 ? "100755" : "100644",
      size: stats.size,
    };
  });
}

/** Fails collection if the work tree is a symlink or not a directory, so root reads nothing else. */
function requireRealDirectory(path: string): void {
  if (sudoCapture(["test", "-h", path]).status === 0) {
    throw new Error(`The work tree ${path} is a symbolic link; refusing to collect through it.`);
  }
  if (sudoCapture(["test", "-d", path]).status !== 0) {
    throw new Error(`The work tree ${path} is not a directory; refusing to collect.`);
  }
}

/**
 * The kind of each path, from one `find` that opens nothing (it only stats): a regular file,
 * a symlink, or `other` (a FIFO, a socket, a directory, or a path that is gone). Paths are given
 * as `./path` so a name that starts with `-` is never read as an option.
 */
export function classifyPaths(
  worktree: string,
  paths: readonly string[],
): Map<string, "file" | "symlink" | "other"> {
  if (paths.length === 0) return new Map();
  const { stdout } = sudoCapture([
    "/usr/bin/env",
    `--chdir=${worktree}`,
    "find",
    ...paths.map((path) => `./${path}`),
    "-maxdepth",
    "0",
    "-printf",
    // Backslash escapes for find to expand: a tab between the type letter and the path, NUL after.
    "%y\\t%p\\0",
  ]);
  return parseFindTypes(stdout, paths);
}

/** Parses `find -printf "%y\\t%p\\0"` into a kind per path; a path `find` did not report is `other`. */
export function parseFindTypes(
  output: string,
  paths: readonly string[],
): Map<string, "file" | "symlink" | "other"> {
  const letters = new Map<string, string>();
  for (const entry of output.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    letters.set(entry.slice(tab + 1).replace(/^\.\//, ""), entry.slice(0, tab));
  }
  const kinds = new Map<string, "file" | "symlink" | "other">();
  for (const path of paths) {
    const letter = letters.get(path);
    kinds.set(path, letter === "f" ? "file" : letter === "l" ? "symlink" : "other");
  }
  return kinds;
}

/**
 * Copies `paths` (all regular files) from `worktree` into `tree`, without following symlinks, and
 * returns those it could not copy. If one path makes the batch fail, each is copied on its own, so
 * one failure never costs the rest their copy.
 */
function copyPaths(worktree: string, tree: string, paths: readonly string[]): Set<string> {
  const copy = (list: readonly string[]) =>
    sudo([
      "/usr/bin/env",
      `--chdir=${worktree}`,
      "cp",
      "-P",
      "--preserve=mode",
      "--parents",
      "-t",
      tree,
      "--",
      ...list,
    ]);
  const failed = new Set<string>();
  if (paths.length === 0) return failed;
  try {
    copy(paths);
  } catch {
    // Start again from an empty tree, so no copy ever lands on what the first attempt left.
    sudo(["rm", "-rf", "--", tree]);
    mkdirSync(tree, { recursive: true });
    for (const path of paths) {
      try {
        copy([path]);
      } catch {
        failed.add(path);
      }
    }
  }
  return failed;
}

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/** Copies one file out of the agent's home, only if it is a regular file of at most `maxBytes`. */
export function copyAgentFile(source: string, target: string, maxBytes: number): boolean {
  // Refuse a source reached through a symlink the agent left, so root never follows one out of the
  // sandbox: the lexical path and the fully resolved path match only when no component is a link.
  const lexical = sudoCapture(["realpath", "-s", "--", source]).stdout.trim();
  const resolved = sudoCapture(["realpath", "--", source]).stdout.trim();
  if (!lexical || lexical !== resolved) return false;
  try {
    sudo(["cp", "-P", source, target]);
  } catch {
    return false;
  }
  // -h: change the link itself if the agent left a symlink, never what it points to.
  sudo(["chown", "-h", `${process.getuid?.()}:${process.getgid?.()}`, target]);
  const stats = lstatSync(target);
  return stats.isFile() && stats.size <= maxBytes;
}
