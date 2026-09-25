import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change } from "./collect.ts";
import type { Parsed } from "./output.ts";
import { isManifest } from "./validate.ts";

export const IGNORE_FILE = ".codemanignore";

/** Proposed to repositories that have no `.codemanignore`, and used until they add one. */
export const DEFAULT_IGNORE = `# Paths that Codeman's agent may not change, in .gitignore syntax. \`!\` re-allows a path.
# Codeman always protects .codemanignore and .codeman/, whatever this file says.
# Codeman warns in each run's summary about the paths below that this file no longer protects.

# Workflows and repository automation.
/.github/**

# Configuration of the agent harness.
opencode.json
opencode.jsonc
/.opencode/**

# Instructions for agents. Later runs would follow a changed version before anyone reviewed it.
AGENTS.md
CLAUDE.md
/.claude/**
/.agents/**
`;

/** One path under each rule of DEFAULT_IGNORE, to tell whether a repository still protects it. */
const PROBES = [
  ".github/workflows/codeman.yml",
  "opencode.json",
  "opencode.jsonc",
  ".opencode/agent/build.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ".agents/skills/skill/SKILL.md",
];

/** Why a change is never applied, whatever `.codemanignore` says; undefined if it may be. */
function hardRule(path: string): string | undefined {
  const segments = path.split("/");
  if (path.startsWith("/") || segments.some((part) => ["", ".", "..", ".git"].includes(part))) {
    return "not a valid path in the repository";
  }
  if (path === IGNORE_FILE || segments[0] === ".codeman") return "Codeman's own settings";
  // Apply's token has no `workflows` permission; GitHub would reject the whole commit.
  if (path.startsWith(".github/workflows/")) return "a workflow file";
  return undefined;
}

/**
 * Which paths `.codemanignore` matches, with git's own `.gitignore` rules. Runs in an empty
 * repository with no global or system configuration, so only the given rules apply.
 */
export function ignoredPaths(rules: string, paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const dir = mkdtempSync(join(tmpdir(), "codeman-ignore-"));
  try {
    const env = {
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    const init = spawnSync("git", ["init", "-q", dir], { env, encoding: "utf8" });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr.trim()}`);
    writeFileSync(join(dir, ".git", "info", "exclude"), rules);
    const result = spawnSync(
      "git",
      [
        "-c",
        "core.excludesFile=/dev/null",
        // `git init` turns this on for case-insensitive file systems, such as macOS's.
        "-c",
        "core.ignoreCase=false",
        "check-ignore",
        "--no-index",
        "--stdin",
        "-z",
        "-v",
        "-n",
      ],
      {
        cwd: dir,
        env,
        encoding: "utf8",
        input: `${paths.join("\0")}\0`,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    // 0: some paths match, 1: none do.
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git check-ignore failed: ${result.stderr.trim()}`);
    }
    // Each path yields four fields: source, line, pattern and path. A `!` pattern re-allows.
    const fields = result.stdout.split("\0");
    const ignored = new Set<string>();
    for (let index = 0; index + 3 < fields.length; index += 4) {
      const pattern = fields[index + 2] ?? "";
      if (pattern !== "" && !pattern.startsWith("!")) ignored.add(fields[index + 3] ?? "");
    }
    return ignored;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Paths that DEFAULT_IGNORE protects and the repository's own rules no longer do. */
export function unprotected(rules: string): string[] {
  const ignored = ignoredPaths(rules, PROBES);
  return PROBES.filter((probe) => !ignored.has(probe));
}

export interface Policy {
  /** The repository's `.codemanignore`; null uses DEFAULT_IGNORE. */
  ignore: string | null;
  maxFiles: number;
  maxFileBytes: number;
  /** The task's plan, which the agent keeps current whatever the rules say. */
  planPath: string;
}

export interface CheckedChanges {
  accepted: Change[];
  dropped: { path: string; reason: string }[];
}

/**
 * Splits the agent's changes into those apply commits and those it drops, with the reason.
 * Fails when the accepted changes exceed the file limit: part of a change set is not safe to
 * commit.
 */
export function checkChanges(manifest: unknown, policy: Policy): Parsed<CheckedChanges> {
  if (!isManifest(manifest)) return { ok: false, error: "The agent's manifest is malformed." };
  const dropped: CheckedChanges["dropped"] = [];
  const candidates: Change[] = [];
  for (const change of manifest.changes) {
    const reason = hardRule(change.path);
    if (reason) dropped.push({ path: change.path, reason });
    else candidates.push(change);
  }

  const ignored = ignoredPaths(
    policy.ignore ?? DEFAULT_IGNORE,
    candidates.filter((change) => change.path !== policy.planPath).map((change) => change.path),
  );
  const accepted: Change[] = [];
  for (const change of candidates) {
    const reason = ignored.has(change.path)
      ? `protected by ${IGNORE_FILE}`
      : change.status !== "deleted" && change.type !== "file"
        ? "not a regular file"
        : (change.size ?? 0) > policy.maxFileBytes
          ? `larger than ${policy.maxFileBytes} bytes`
          : undefined;
    if (reason) dropped.push({ path: change.path, reason });
    else accepted.push(change);
  }

  if (accepted.length > policy.maxFiles) {
    return {
      ok: false,
      error: `The agent changed ${accepted.length} files; the limit is ${policy.maxFiles} per run (\`max-files\`).`,
    };
  }
  return { ok: true, value: { accepted, dropped } };
}
