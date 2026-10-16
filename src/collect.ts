import { lstatSync, mkdirSync, rmSync, type Stats } from "node:fs";
import { join } from "node:path";
import { sudo } from "./sandbox.ts";

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
  const status = sudo(statusCommand(options.gitDir, options.worktree));
  const changes = parseStatus(status).filter(
    ({ path }) =>
      !options.exclude.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );

  const tree = join(options.outDir, "tree");
  mkdirSync(tree, { recursive: true });
  const copies = changes
    .filter((change) => change.status !== "deleted" && change.type === undefined)
    .map(({ path }) => path);
  const failed = copyPaths(options.worktree, tree, copies);
  if (copies.length > 0) {
    sudo(["chown", "-R", `${process.getuid?.()}:${process.getgid?.()}`, tree]);
  }

  return changes.map((change): Change => {
    if (change.status === "deleted" || change.type !== undefined) return change;
    const copy = join(tree, change.path);
    const stats = failed.has(change.path) ? undefined : lstatOrUndefined(copy);
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

/**
 * Copies `paths` from `worktree` into `tree`, without following symlinks, and returns those it
 * could not copy. One path `cp` refuses, such as a directory, fails the whole command, so then
 * each path is copied on its own.
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
