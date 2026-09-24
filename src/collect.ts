import { lstatSync, mkdirSync, rmSync } from "node:fs";
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
  changes: Change[];
}

/** Parses `git status --porcelain=v1 -z --no-renames`, comparing the work tree with the checkout. */
export function parseStatus(output: string): Pick<Change, "path" | "status">[] {
  const changes: Pick<Change, "path" | "status">[] = [];
  for (const entry of output.split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code === "??") changes.push({ path, status: "added" });
    else if (code[1] === "D") changes.push({ path, status: "deleted" });
    else if (code[1] === "M" || code[1] === "T") changes.push({ path, status: "modified" });
  }
  return changes;
}

/**
 * Lists what the agent changed and copies the changed files into `outDir/tree`.
 *
 * The agent controls its copy of the repository, including `.git`, so git runs with the
 * original checkout's `.git` (trusted) against the agent's work tree. Only regular files are
 * copied; symlinks and special files are listed in the manifest but not copied.
 */
export function collectChanges(options: {
  gitDir: string;
  worktree: string;
  outDir: string;
  exclude: readonly string[];
}): Change[] {
  const status = sudo([
    "git",
    "--no-optional-locks",
    "-c",
    "safe.directory=*",
    "-c",
    "core.fsmonitor=false",
    `--git-dir=${options.gitDir}`,
    `--work-tree=${options.worktree}`,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  const changes = parseStatus(status).filter(
    ({ path }) =>
      !options.exclude.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );

  const tree = join(options.outDir, "tree");
  mkdirSync(tree, { recursive: true });
  const copies = changes.filter((change) => change.status !== "deleted").map(({ path }) => path);
  if (copies.length > 0) {
    sudo([
      "/usr/bin/env",
      `--chdir=${options.worktree}`,
      "cp",
      "-P",
      "--preserve=mode",
      "--parents",
      "-t",
      tree,
      "--",
      ...copies,
    ]);
    sudo(["chown", "-R", `${process.getuid?.()}:${process.getgid?.()}`, tree]);
  }

  return changes.map((change): Change => {
    if (change.status === "deleted") return change;
    const copy = join(tree, change.path);
    const stats = lstatSync(copy);
    if (!stats.isFile()) {
      // Keep only the fact that it changed: the artifact upload would follow a symlink.
      rmSync(copy, { recursive: true, force: true });
      return { ...change, type: stats.isSymbolicLink() ? "symlink" : "other" };
    }
    return {
      ...change,
      type: "file",
      mode: stats.mode & 0o111 ? "100755" : "100644",
      size: stats.size,
    };
  });
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
