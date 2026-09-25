import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectChanges, copyAgentFile } from "./collect.ts";
import {
  AGENT_HOME,
  AGENT_USER,
  copyToAgent,
  createAgentUser,
  killAgentProcesses,
  runAsAgent,
} from "./sandbox.ts";

// Creates a system user and needs passwordless sudo, like GitHub's Linux runners. CI sets this.
const enabled = process.platform === "linux" && process.env.CODEMAN_SANDBOX_TEST === "1";

test("the agent is contained and its changes are collected safely", {
  skip: !enabled,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "codeman-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "hello\n");
  writeFileSync(join(repo, "src", "a.txt"), "a\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");
  process.env.CODEMAN_RUNNER_SECRET = "runner-only-secret";
  const home = homedir();
  const runnerTemp = process.env.RUNNER_TEMP ?? `${home}/work/_temp`;
  process.env.PATH = `${home}/.cargo/bin:/opt/codeman-test/bin:${process.env.PATH ?? ""}`;

  createAgentUser();
  const worktree = `${AGENT_HOME}/work`;
  copyToAgent(repo, worktree);
  const script = [
    "echo changed >> README.md",
    "mkdir -p plans && echo plan > plans/p.md",
    "rm src/a.txt",
    "mkdir -p node_modules && echo x > node_modules/x.js",
    "ln -s /etc/shadow leak.txt",
    "mkdir -p .codeman && ln -s /etc/shadow .codeman/output.json",
    "sudo -n true 2>/dev/null && echo yes > sudo.txt",
    `cat /proc/${process.pid}/environ > environ.txt 2>/dev/null`,
    'echo "$OPENROUTER_API_KEY" > key.txt',
    "env > env.txt",
    `ls -A '${home}' >/dev/null 2>&1 && echo yes > home.txt`,
    `ls -A '${runnerTemp}' >/dev/null 2>&1 && echo yes > temp.txt`,
    "[ -w /var/run/docker.sock ] && echo yes > docker.txt",
    "(sleep 300 >/dev/null 2>&1 &)",
    "exit 0",
  ].join("\n");

  const run = await runAsAgent(
    { file: "/bin/bash", args: ["-c", script], env: { OPENROUTER_API_KEY: "sk-test" } },
    worktree,
    60_000,
  );
  assert.deepEqual(run, { exitCode: 0, timedOut: false });
  killAgentProcesses();
  let survivors = true;
  for (let attempt = 0; survivors && attempt < 20; attempt++) {
    survivors = spawnSync("pgrep", ["-u", AGENT_USER]).status === 0;
    if (survivors) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(!survivors, "no agent process survives");

  const out = join(root, "result");
  const changes = collectChanges({
    gitDir: join(repo, ".git"),
    worktree,
    outDir: out,
    exclude: [".codeman"],
  });
  const byPath = new Map(changes.map((change) => [change.path, change]));

  assert.equal(byPath.get("README.md")?.status, "modified");
  assert.equal(byPath.get("plans/p.md")?.type, "file");
  assert.equal(byPath.get("src/a.txt")?.status, "deleted");
  assert.equal(byPath.get("leak.txt")?.type, "symlink");
  assert.ok(!existsSync(join(out, "tree", "leak.txt")), "links are listed, not copied");
  assert.ok(![...byPath.keys()].some((path) => path.startsWith("node_modules")), "ignored files");
  assert.ok(![...byPath.keys()].some((path) => path.startsWith(".codeman")), "excluded files");
  assert.ok(!byPath.has("sudo.txt"), "the agent cannot use sudo");
  const environ = readFileSync(join(out, "tree", "environ.txt"), "utf8");
  assert.ok(!environ.includes("runner-only-secret"), "the agent cannot read the runner's env");
  assert.equal(readFileSync(join(out, "tree", "key.txt"), "utf8").trim(), "sk-test");
  const agentEnv = readFileSync(join(out, "tree", "env.txt"), "utf8");
  assert.ok(!agentEnv.includes("/home/runner"), "no path from the runner's environment");
  assert.match(agentEnv, /^XDG_CONFIG_HOME=\/home\/codeman-agent\/\.config$/m);
  assert.match(
    agentEnv,
    /^PATH=\/opt\/codeman-test\/bin:/m,
    "the job's PATH, without the runner's home",
  );
  assert.ok(!byPath.has("home.txt"), "the agent cannot read the runner's home");
  assert.ok(!byPath.has("temp.txt"), "the agent cannot read the job's temporary files");
  assert.ok(!byPath.has("docker.txt"), "the agent cannot use Docker");

  assert.equal(
    copyAgentFile(`${worktree}/.codeman/output.json`, join(out, "output.json"), 1024),
    false,
    "a symlinked output file is refused",
  );
  assert.notEqual(
    lstatSync("/etc/shadow").uid,
    process.getuid?.(),
    "chown did not follow the link",
  );
});
