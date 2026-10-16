import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseFindTypes, parseStatus, statusCommand } from "./collect.ts";

test("classifies find's output, and treats a path find did not report as other", () => {
  const output = "f\t./src/a.ts\0l\t./link\0p\t./pipe\0d\t./dir\0";
  const kinds = parseFindTypes(output, ["src/a.ts", "link", "pipe", "dir", "gone"]);
  assert.deepEqual(Object.fromEntries(kinds), {
    "src/a.ts": "file",
    link: "symlink",
    pipe: "other",
    dir: "other",
    gone: "other",
  });
});

test("the status command stays out of submodules, whose configuration the agent controls", () => {
  const root = mkdtempSync(join(tmpdir(), "codeman-status-"));
  try {
    const env = {
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd,
        env,
        encoding: "utf8",
      });
    // The checkout, with a submodule, and the agent's copy of its work tree.
    const repo = join(root, "repo");
    git(root, "init", "-q", repo);
    writeFileSync(join(repo, "README.md"), "hello\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    const head = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "update-index", "--add", "--cacheinfo", `160000,${head},vendor/lib`);
    git(repo, "commit", "-qm", "submodule");
    const work = join(root, "work");
    cpSync(repo, work, { recursive: true, filter: (path) => !path.includes("/.git") });

    // The agent's submodule: a changed file, and a clean filter that leaves a marker if run.
    const lib = join(work, "vendor", "lib");
    git(root, "init", "-q", lib);
    writeFileSync(join(lib, "f"), "a\n");
    git(lib, "add", "f");
    git(lib, "commit", "-qm", "x");
    writeFileSync(join(lib, ".gitattributes"), "* filter=probe\n");
    const entered = join(root, "entered");
    git(lib, "config", "filter.probe.clean", `touch '${entered}'; cat`);
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(lib, "f"), later, later);

    const command = statusCommand(join(repo, ".git"), work);
    const run = (args: string[]) => {
      const result = spawnSync(args[0] ?? "", args.slice(1), { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return parseStatus(result.stdout);
    };
    // Without the option, git enters the submodule: the probe works.
    assert.deepEqual(run(command.filter((arg) => arg !== "--ignore-submodules=all")), [
      { path: "vendor/lib", status: "modified" },
    ]);
    assert.ok(existsSync(entered));
    rmSync(entered);

    assert.deepEqual(run(command), []);
    assert.ok(!existsSync(entered), "git did not enter the submodule");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
