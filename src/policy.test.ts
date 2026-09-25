import assert from "node:assert/strict";
import { test } from "node:test";
import type { Change, Manifest } from "./collect.ts";
import { checkChanges, DEFAULT_IGNORE, ignoredPaths, unprotected } from "./policy.ts";

const file = (path: string, size = 10): Change => ({
  path,
  status: "modified",
  type: "file",
  mode: "100644",
  size,
});

const manifest = (changes: Change[]): Manifest => ({
  version: 1,
  harness: "opencode",
  exitCode: 0,
  timedOut: false,
  changes,
});

const policy = {
  ignore: null,
  maxFiles: 300,
  maxFileBytes: 1000,
  planPath: "plans/2026-09-25-x.md",
};

test("the proposed rules protect workflows, harness settings and agent instructions", () => {
  const ignored = ignoredPaths(DEFAULT_IGNORE, [
    ".github/workflows/ci.yml",
    ".github/CODEOWNERS",
    "opencode.json",
    ".opencode/agent/x.md",
    "AGENTS.md",
    "packages/api/AGENTS.md",
    "CLAUDE.md",
    ".claude/settings.json",
    ".agents/skills/x/SKILL.md",
    "src/index.ts",
    "docs/agents.md",
    "src/.github/fixture.yml",
  ]);
  assert.deepEqual([...ignored].sort(), [
    ".agents/skills/x/SKILL.md",
    ".claude/settings.json",
    ".github/CODEOWNERS",
    ".github/workflows/ci.yml",
    ".opencode/agent/x.md",
    "AGENTS.md",
    "CLAUDE.md",
    "opencode.json",
    "packages/api/AGENTS.md",
  ]);
});

test("`!` re-allows a path, and odd paths are matched literally", () => {
  const rules =
    "/.claude/**\n!/.claude/notes.md\n!/.claude/commands/\n!/.claude/commands/**\n*.secret\n";
  const ignored = ignoredPaths(rules, [
    ".claude/settings.json",
    ".claude/notes.md",
    ".claude/commands/review.md",
    "a b/c.secret",
    "new\nline.secret",
    "-n",
  ]);
  assert.deepEqual([...ignored].sort(), [
    ".claude/settings.json",
    "a b/c.secret",
    "new\nline.secret",
  ]);
});

test("warns about each proposed rule that the repository dropped", () => {
  assert.deepEqual(unprotected(DEFAULT_IGNORE), []);
  const rules = DEFAULT_IGNORE.replace("AGENTS.md\n", "").replace("/.github/**", "/.github/*.md");
  assert.deepEqual(unprotected(rules), [".github/workflows/codeman.yml", "AGENTS.md"]);
});

test("drops protected, special and large files, and keeps the plan", () => {
  const result = checkChanges(
    manifest([
      file("src/a.ts"),
      { path: "src/old.ts", status: "deleted" },
      file("AGENTS.md"),
      file(".codemanignore"),
      file(".codeman/settings.yml"),
      file(".github/workflows/ci.yml"),
      { path: "link", status: "added", type: "symlink" },
      file("big.bin", 1001),
      file("../escape"),
      file("a//b"),
      file(policy.planPath),
    ]),
    { ...policy, ignore: "plans/**\n" },
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.accepted.map((change) => change.path),
    ["src/a.ts", "src/old.ts", "AGENTS.md", policy.planPath],
  );
  assert.deepEqual(
    Object.fromEntries(result.value.dropped.map(({ path, reason }) => [path, reason])),
    {
      ".codemanignore": "Codeman's own settings",
      ".codeman/settings.yml": "Codeman's own settings",
      ".github/workflows/ci.yml": "a workflow file",
      link: "not a regular file",
      "big.bin": "larger than 1000 bytes",
      "../escape": "not a valid path in the repository",
      "a//b": "not a valid path in the repository",
    },
  );
});

test("uses the proposed rules when the repository has none", () => {
  const result = checkChanges(manifest([file("AGENTS.md")]), policy);
  assert.ok(result.ok);
  assert.deepEqual(result.value.dropped, [
    { path: "AGENTS.md", reason: "protected by .codemanignore" },
  ]);
});

test("commits nothing when the run changes too many files", () => {
  const result = checkChanges(manifest([file("a"), file("b"), file("c")]), {
    ...policy,
    maxFiles: 2,
  });
  assert.ok(!result.ok && result.error.includes("max-files"));
  assert.equal(checkChanges({ version: 2 }, policy).ok, false);
});
