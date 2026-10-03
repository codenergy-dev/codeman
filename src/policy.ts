import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change } from "./collect.ts";
import type { Parsed } from "./output.ts";
import type { WorkflowConventions } from "./platform/conventions.ts";
import { isManifest } from "./validate.ts";
import { isWebPath } from "./webdocs.ts";

export const IGNORE_FILE = ".codemanignore";
/** Where apply puts the agent's workflow files until a maintainer accepts them. */
export const STAGED_WORKFLOWS_DIR = ".codeman/workflows/";

/** `.github/workflows/deploy.yml` → `.codeman/workflows/deploy.yml`, on GitHub. */
export function stagedPath(path: string, workflows: WorkflowConventions): string {
  return STAGED_WORKFLOWS_DIR + path.slice(workflows.dir.length);
}

/** `.codeman/workflows/deploy.yml` → `.github/workflows/deploy.yml`, on GitHub. */
export function workflowPath(staged: string, workflows: WorkflowConventions): string {
  return workflows.dir + staged.slice(STAGED_WORKFLOWS_DIR.length);
}

const IGNORE_HEADER = `# Paths that Codeman's agent may not change, in .gitignore syntax. \`!\` re-allows a path.
# Codeman always protects .codemanignore and .codeman/, whatever this file says.
# Codeman warns in each run's summary about the paths below that this file no longer protects.
`;

const IGNORE_RULES = `# Configuration of the agent harness.
opencode.json
opencode.jsonc
/.opencode/**

# Instructions for agents. Later runs would follow a changed version before anyone reviewed it.
AGENTS.md
CLAUDE.md
/.claude/**
/.agents/**
`;

/**
 * Proposed to repositories that have no `.codemanignore`, and used until they add one: the
 * platform's CI configuration, then the harness's and the agents' rules.
 */
export function defaultIgnore(workflows: WorkflowConventions): string {
  return `${IGNORE_HEADER}\n${workflows.protect}\n${IGNORE_RULES}`;
}

/** One path under each rule of IGNORE_RULES, to tell whether a repository still protects it. */
const PROBES = [
  "opencode.json",
  "opencode.jsonc",
  ".opencode/agent/build.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ".agents/skills/skill/SKILL.md",
];

/** Why apply drops a change. Rendered in the task's language. */
export type DropReason =
  | { kind: "invalid-path" }
  | { kind: "codeman-settings" }
  | { kind: "protected" }
  | { kind: "not-a-file" }
  | { kind: "too-large"; max: number }
  | { kind: "workflow-deletion" }
  /** The web stage changes only `docs/web/`. */
  | { kind: "web-stage-only" }
  /** Only the web stage changes `docs/web/`. */
  | { kind: "web-docs" }
  /** A page or tool in `docs/web/` whose front matter or name is invalid. */
  | { kind: "invalid-web-page"; problem: string };

/** Why a change is never applied, whatever `.codemanignore` says; undefined if it may be. */
function hardRule(path: string): DropReason | undefined {
  const segments = path.split("/");
  if (path.startsWith("/") || segments.some((part) => ["", ".", "..", ".git"].includes(part))) {
    return { kind: "invalid-path" };
  }
  if (path === IGNORE_FILE || segments[0] === ".codeman") return { kind: "codeman-settings" };
  return undefined;
}

/** Who may change third-party documentation: the web stage, and only it. */
function webRule(path: string, policy: Policy): DropReason | undefined {
  if (policy.webDocs === "only" && path !== policy.planPath && !isWebPath(path)) {
    return { kind: "web-stage-only" };
  }
  if (policy.webDocs === "never" && isWebPath(path)) return { kind: "web-docs" };
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

/** Paths that `defaultIgnore` protects and the repository's own rules no longer do. */
export function unprotected(rules: string, workflows: WorkflowConventions): string[] {
  const probes = [...workflows.probes, ...PROBES];
  const ignored = ignoredPaths(rules, probes);
  return probes.filter((probe) => !ignored.has(probe));
}

export interface Policy {
  /** The repository's `.codemanignore`; null uses `defaultIgnore`. */
  ignore: string | null;
  workflows: WorkflowConventions;
  maxFiles: number;
  maxFileBytes: number;
  /** The task's plan, which the agent keeps current whatever the rules say. */
  planPath: string;
  /**
   * Third-party documentation: `only` for the web stage, which changes nothing else but the
   * plan; `never` for the other stages, which read it as data.
   */
  webDocs?: "only" | "never" | undefined;
}

export interface CheckedChanges {
  accepted: Change[];
  /**
   * Workflow files, committed to STAGED_WORKFLOWS_DIR instead: a workflow on the branch would
   * run, with the repository's secrets, before anyone read it.
   */
  staged: Change[];
  dropped: { path: string; reason: DropReason }[];
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
    const reason = hardRule(change.path) ?? webRule(change.path, policy);
    if (reason) dropped.push({ path: change.path, reason });
    else candidates.push(change);
  }

  const ignored = ignoredPaths(
    policy.ignore ?? defaultIgnore(policy.workflows),
    candidates.filter((change) => change.path !== policy.planPath).map((change) => change.path),
  );
  const accepted: Change[] = [];
  const staged: Change[] = [];
  for (const change of candidates) {
    const workflow = change.path.startsWith(policy.workflows.dir);
    const reason: DropReason | undefined = ignored.has(change.path)
      ? { kind: "protected" }
      : change.status !== "deleted" && change.type !== "file"
        ? { kind: "not-a-file" }
        : (change.size ?? 0) > policy.maxFileBytes
          ? { kind: "too-large", max: policy.maxFileBytes }
          : workflow && change.status === "deleted"
            ? { kind: "workflow-deletion" }
            : undefined;
    if (reason) dropped.push({ path: change.path, reason });
    else if (workflow) staged.push(change);
    else accepted.push(change);
  }

  const count = accepted.length + staged.length;
  if (count > policy.maxFiles) {
    return {
      ok: false,
      error: `The agent changed ${count} files; the limit is ${policy.maxFiles} per run (\`max-files\`).`,
    };
  }
  return { ok: true, value: { accepted, staged, dropped } };
}
