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
import { collectChanges, copyLiveAgentFile, copySealedAgentFile } from "./collect.ts";
import {
  AGENT_HOME,
  AGENT_USER,
  copyToAgent,
  createAgentUser,
  killAgentProcesses,
  runAsAgent,
  sealAgentSandbox,
} from "./sandbox.ts";
import { FakeRuntime } from "./testing/fake-runtime.ts";

// Creates a system user and needs passwordless sudo, like GitHub's Linux runners. CI sets this.
const enabled = process.platform === "linux" && process.env.CODEMAN_SANDBOX_TEST === "1";

// A FIFO that cp would block on fails the test as a timeout, not a hang, if its filter regresses.
test("the agent is contained and its changes are collected safely", {
  skip: !enabled,
  timeout: 120_000,
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
  // A submodule, whose repository the agent will create: collection must not enter it.
  const head = git("rev-parse", "HEAD").toString().trim();
  git("update-index", "--add", "--cacheinfo", `160000,${head},vendor/lib`);
  git("commit", "-qm", "submodule");
  process.env.CODEMAN_RUNNER_SECRET = "runner-only-secret";
  const home = homedir();
  const runnerTemp = process.env.RUNNER_TEMP ?? `${home}/work/_temp`;
  process.env.PATH = `${home}/.cargo/bin:/opt/codeman-test/bin:${process.env.PATH ?? ""}`;

  // Codeman's own checkout, inside the workspace in the agent job, stays out of the copy.
  mkdirSync(join(repo, ".codeman", "action"), { recursive: true });
  writeFileSync(join(repo, ".codeman", "action", "action.yml"), "name: Codeman\n");

  createAgentUser();
  const worktree = `${AGENT_HOME}/work`;
  copyToAgent(repo, worktree, [".codeman/action"]);
  const copied = (path: string) => spawnSync("sudo", ["-n", "test", "-e", path]).status === 0;
  assert.ok(copied(`${worktree}/README.md`));
  assert.ok(!copied(`${worktree}/.codeman/action`), "the action's folder is not copied");
  assert.throws(() => copyToAgent(repo, worktree, ["../x"]), /not a path inside the copy/);
  assert.ok(copied(`${worktree}/README.md`), "a refused exclusion changes nothing");
  // Only root can write here, as collection runs; the agent cannot.
  const entered = join(root, "submodule-entered");
  const script = [
    "echo changed >> README.md",
    "mkdir -p plans && echo plan > plans/p.md",
    "rm src/a.txt",
    // Scratch clones: embedded repositories, which git lists as directories.
    "git init -q scratch/up && echo x > scratch/up/f.txt",
    // A submodule with a changed file and a clean filter that leaves a marker if git runs it.
    "git init -q vendor/lib && cd vendor/lib && echo a > f && git add f",
    "git -c user.name=a -c user.email=a@a commit -q -m x && echo '* filter=probe' > .gitattributes",
    `git config filter.probe.clean 'touch ${entered}; cat' && sleep 1 && touch f && cd ../..`,
    "mkdir -p node_modules && echo x > node_modules/x.js",
    // A FIFO in a tracked path: cp must never open it (it would block), so it is listed, not copied.
    "mkfifo pipe",
    "ln -s /etc/shadow leak.txt",
    "mkdir -p .codeman && ln -s /etc/shadow .codeman/output.json",
    `echo '{"ok":1}' > .codeman/ok.json && mkfifo .codeman/pipe.json`,
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
    new FakeRuntime(),
  );
  assert.deepEqual(run, { exitCode: 0, timedOut: false });
  // While the sandbox is live, files are read as the agent: no symlink, no pipe, the size checked.
  const live = (name: string, max = 1024) =>
    copyLiveAgentFile(`${worktree}/.codeman/${name}`, join(root, `live-${name}`), max);
  assert.equal(live("output.json"), false, "a symlinked file is refused while live");
  assert.equal(live("pipe.json"), false, "a pipe is refused while live, without blocking");
  assert.equal(live("ok.json"), true);
  assert.equal(readFileSync(join(root, "live-ok.json"), "utf8"), '{"ok":1}\n');
  assert.equal(live("ok.json", 4), false, "a file over the limit is refused");

  // Seals the sandbox: stops the agent, checks none of its processes survive, and takes its paths.
  sealAgentSandbox(worktree);

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
  assert.equal(byPath.get("pipe")?.type, "other", "a FIFO is listed as other");
  assert.ok(!existsSync(join(out, "tree", "pipe")), "a FIFO is not copied");
  assert.deepEqual(byPath.get("scratch/up"), {
    path: "scratch/up",
    status: "added",
    type: "other",
  });
  assert.ok(!byPath.has("vendor/lib"), "submodules are not listed");
  assert.ok(!existsSync(entered), "git did not enter the submodule");
  assert.ok(!existsSync(join(out, "tree", "scratch")), "embedded repositories are not copied");
  assert.ok(!existsSync(join(out, "tree", "vendor", "lib")), "a submodule is not copied");
  assert.ok(
    ![...byPath.keys()].some((path) => path.startsWith("scratch/up/")),
    "nor listed inside",
  );
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
    copySealedAgentFile(`${worktree}/.codeman/output.json`, join(out, "output.json"), 1024),
    false,
    "a symlinked output file is refused",
  );
  const sealed = (name: string) =>
    copySealedAgentFile(`${worktree}/.codeman/${name}`, join(out, `sealed-${name}`), 1024);
  assert.equal(sealed("pipe.json"), false, "a pipe is refused after the seal, without blocking");
  assert.equal(sealed("ok.json"), true);
  assert.notEqual(
    lstatSync("/etc/shadow").uid,
    process.getuid?.(),
    "chown did not follow the link",
  );
});

test("the agent stops when its run does, with the reason", { skip: !enabled }, async () => {
  createAgentUser();
  const stop = new AbortController();
  setTimeout(() => stop.abort(new Error("No worker started.")), 200);
  const runtime = new FakeRuntime();
  const run = await runAsAgent(
    { file: "/bin/bash", args: ["-c", "sleep 300"], env: {} },
    AGENT_HOME,
    60_000,
    runtime,
    stop.signal,
  );
  assert.equal(run.stopped, "No worker started.");
  assert.equal(run.timedOut, false);
  assert.match(runtime.logged("warning")[0] ?? "", /The agent was stopped: No worker started\./);
  killAgentProcesses();
});

test("collection refuses a work tree the agent turned into a symlink", { skip: !enabled }, () => {
  const root = mkdtempSync(join(tmpdir(), "codeman-link-"));
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "hello\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");

  // A directory outside the sandbox that the agent should not be able to have root read.
  const secrets = join(root, "secrets");
  mkdirSync(secrets, { recursive: true });
  writeFileSync(join(secrets, "token.txt"), "secret\n");

  createAgentUser();
  const worktree = `${AGENT_HOME}/work`;
  spawnSync("sudo", ["-n", "rm", "-rf", worktree]);
  spawnSync("sudo", ["-n", "-u", AGENT_USER, "ln", "-s", secrets, worktree]);

  const out = join(root, "result");
  assert.throws(
    () => collectChanges({ gitDir: join(repo, ".git"), worktree, outDir: out, exclude: [] }),
    /symbolic link/,
  );
  assert.ok(!existsSync(join(out, "tree", "token.txt")), "nothing outside the sandbox is copied");
});
