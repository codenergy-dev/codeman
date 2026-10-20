import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { collectChanges, copyLiveAgentFile, copySealedAgentFile } from "./collect.ts";
import {
  AGENT_HOME,
  AGENT_USER,
  copyToAgent,
  createAgentUser,
  type FileStats,
  findProgram,
  jailArgs,
  jailScript,
  killAgentProcesses,
  runAsAgent,
  sealAgentSandbox,
  sudoArgs,
  untrustedReason,
} from "./sandbox.ts";
import { FakeRuntime } from "./testing/fake-runtime.ts";

// Creates a system user and needs passwordless sudo, like GitHub's Linux runners. CI sets this.
const enabled = process.platform === "linux" && process.env.CODEMAN_SANDBOX_TEST === "1";

type FakeEntry = { uid?: number; mode: number } | { uid?: number; link: string };

/** A fake file system: each path's owner (root by default) and mode, or a link's target. */
function fakeFs(entries: Record<string, FakeEntry>): FileStats {
  return {
    lstat: (path) => {
      const entry = entries[path];
      if (!entry) return undefined;
      const link = "link" in entry;
      return { uid: entry.uid ?? 0, mode: link ? 0o777 : entry.mode, isSymbolicLink: () => link };
    },
    readlink: (path) => {
      const entry = entries[path];
      if (!entry || !("link" in entry)) throw new Error(`Not a link: ${path}`);
      return entry.link;
    },
  };
}

/** Ubuntu's layout, where only root writes: /bin links to usr/bin. */
const ubuntu: Record<string, FakeEntry> = {
  "/": { mode: 0o755 },
  "/usr": { mode: 0o755 },
  "/usr/bin": { mode: 0o755 },
  "/usr/bin/sudo": { mode: 0o4755 },
  "/usr/sbin": { mode: 0o755 },
  "/bin": { link: "usr/bin" },
  "/sbin": { link: "usr/sbin" },
  "/usr/local": { mode: 0o755 },
  "/usr/local/bin": { mode: 0o755 },
  "/opt": { mode: 0o755 },
  "/tmp": { mode: 0o1777 },
};

test("a path is trusted only when root alone can change it", () => {
  const reason = (path: string, extra: Record<string, FakeEntry> = {}) =>
    untrustedReason(path, fakeFs({ ...ubuntu, ...extra }));
  assert.equal(reason("/usr/bin/sudo"), undefined);
  assert.equal(reason("/bin/sudo"), undefined, "through root's own link");
  assert.match(reason("/opt/x/y", { "/opt": { mode: 0o777 } }) ?? "", /^\/opt is writable/);
  assert.match(
    reason("/usr/local/bin/x", { "/usr/local/bin": { uid: 1001, mode: 0o755 } }) ?? "",
    /^\/usr\/local\/bin is not owned by root/,
  );
  assert.match(
    reason("/usr/bin/x", { "/usr/bin/x": { mode: 0o775 } }) ?? "",
    /^\/usr\/bin\/x is writable/,
    "a group-writable file",
  );
  assert.match(
    reason("/usr/bin/x", {
      "/usr/bin/x": { link: "/opt/pipx_bin/x" },
      "/opt": { mode: 0o777 },
      "/opt/pipx_bin": { mode: 0o755 },
      "/opt/pipx_bin/x": { mode: 0o755 },
    }) ?? "",
    /^\/opt is writable/,
    "a link out of a trusted directory",
  );
  assert.match(
    reason("/usr/bin/a", { "/usr/bin/a": { link: "b" }, "/usr/bin/b": { link: "a" } }) ?? "",
    /more than 40 links/,
  );
  assert.match(reason("/usr/bin/x") ?? "", /^\/usr\/bin\/x does not exist/);
});

test("programs come only from trusted directories", () => {
  const find = (extra: Record<string, FakeEntry>) =>
    findProgram("x", fakeFs({ ...ubuntu, ...extra }));
  const file = { mode: 0o755 };
  assert.equal(find({ "/usr/local/bin/x": file, "/usr/bin/x": file }), "/usr/bin/x");
  assert.equal(find({ "/usr/sbin/x": file }), "/usr/sbin/x");
  assert.equal(find({ "/usr/bin/x": { mode: 0o777 }, "/usr/sbin/x": file }), "/usr/sbin/x");
  const sbin = { "/sbin": { mode: 0o755 }, "/sbin/x": file };
  assert.equal(find(sbin), "/sbin/x", "when only /sbin has it");
  assert.throws(() => find({ "/usr/local/bin/x": file }), /Codeman runs x only from/);
  assert.throws(
    () => find({ "/opt/pipx_bin": { mode: 0o777 }, "/opt/pipx_bin/x": { mode: 0o777 } }),
    /Codeman runs x only from/,
  );
  assert.throws(() => find({ "/usr/bin/x": { uid: 1001, mode: 0o755 } }), /not owned by root/);
});

test("sudo's arguments name the command by its trusted path", () => {
  const resolve = (name: string) => `/t/${name}`;
  assert.deepEqual(sudoArgs("git", ["status"], undefined, resolve), [
    "-n",
    "--",
    "/t/git",
    "status",
  ]);
  assert.deepEqual(sudoArgs("git", ["status"], AGENT_USER, resolve), [
    "-n",
    "-u",
    "codeman-agent",
    "--",
    "/t/git",
    "status",
  ]);
});

test("the agent job runs no program by its name", () => {
  for (const file of [
    "sandbox.ts",
    "collect.ts",
    "results.ts",
    "harness/opencode.ts",
    "steps/agent.ts",
  ]) {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    assert.doesNotMatch(source, /\bspawn(Sync)?\(\s*["'`]/, `${file} spawns a program by its name`);
    assert.doesNotMatch(
      source,
      /\b(sudo|sudoCapture|sudoAs)\(\s*\[/,
      `${file} runs a program under sudo by its name`,
    );
  }
});

test("the jail names its programs by their trusted paths, and shares the network", () => {
  const resolve = (name: string) => `/t/${name}`;
  const command = {
    file: "/opt/codeman/opencode",
    args: ["run", "--model", "m"],
    env: { OPENROUTER_API_KEY: "sk-secret", OTHER: "x" },
  };
  const args = jailArgs(command, `${AGENT_HOME}/work`, "LAUNCHER", resolve);
  assert.deepEqual(args.slice(0, 4), [
    "-n",
    "--preserve-env=OPENROUTER_API_KEY,OTHER",
    "--",
    "/t/unshare",
  ]);
  const namespaces = args.slice(4, args.indexOf("--", 4));
  for (const flag of ["--mount", "--pid", "--ipc", "--fork", "--kill-child"]) {
    assert.ok(namespaces.includes(flag), `unshare gets ${flag}`);
  }
  assert.deepEqual(namespaces.slice(-2), ["--propagation", "private"]);
  assert.ok(!namespaces.some((flag) => /^--(net|user)/.test(flag)), "the network is shared");
  const script = args.indexOf("-c");
  assert.equal(args[script - 1], "/t/bash");
  assert.equal(args[script + 1], jailScript(resolve));
  assert.deepEqual(args.slice(script + 2), [
    "codeman-jail",
    "LAUNCHER",
    "OPENROUTER_API_KEY OTHER",
    `${AGENT_HOME}/work`,
    "/opt/codeman/opencode",
    "run",
    "--model",
    "m",
  ]);
  assert.ok(!args.join(" ").includes("sk-secret"), "secrets stay in the environment");
});

/** Runs the jail's setup with stubs for its programs, which log their arguments. */
function runJailScript(mounts: string[], failing = "") {
  const dir = mkdtempSync(join(tmpdir(), "codeman-jail-"));
  const log = join(dir, "log");
  const stub = (name: string, body = "") =>
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n${body}\n`, {
      mode: 0o755,
    });
  stub("findmnt", `printf '%s\\n' ${mounts.map((mount) => `'${mount}'`).join(" ")}`);
  stub("mount", failing ? `case "$*" in *'${failing}'*) exit 32 ;; esac` : "");
  stub("setpriv");
  const result = spawnSync(
    "/bin/bash",
    ["-c", jailScript((name) => join(dir, name)), "codeman-jail", "LAUNCHER", "KEY", "/w", "/h"],
    { encoding: "utf8" },
  );
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { status: result.status, lines, bash: join(dir, "bash") };
}

test("the jail makes every mount read-only but the agent's home, then drops to the agent", () => {
  const { status, lines, bash } = runJailScript([
    "/",
    "/proc",
    "/proc/sys",
    "/mnt/a\\x20b",
    "/tmp",
  ]);
  assert.equal(status, 0);
  const tmpfs = (dir: string) => `mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs ${dir}`;
  assert.deepEqual(lines, [
    "findmnt -rn -o TARGET",
    "mount -o remount,bind,ro /",
    "mount -o remount,bind,ro /mnt/a b",
    "mount -o remount,bind,ro /tmp",
    "mount -t proc -o nosuid,nodev,noexec proc /proc",
    tmpfs("/tmp"),
    tmpfs("/var/tmp"),
    tmpfs("/dev/shm"),
    // The system bus is hidden where the host has one.
    ...(existsSync("/run/dbus")
      ? ["mount -t tmpfs -o mode=755,nosuid,nodev,noexec tmpfs /run/dbus"]
      : []),
    `mount --bind ${AGENT_HOME} ${AGENT_HOME}`,
    `mount -o remount,bind,rw,nosuid,nodev ${AGENT_HOME}`,
    `setpriv --reuid=${AGENT_USER} --regid=${AGENT_USER} --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all -- ${bash} -c LAUNCHER ${AGENT_USER} KEY /w /h`,
  ]);
  assert.doesNotMatch(
    jailScript((name) => `/t/${name}`),
    /\bexec\b/,
    "root's shell stays PID 1, to reap orphans",
  );
});

test("the jail does not run the agent when a mount stays writable", () => {
  const { status, lines } = runJailScript(["/", "/mnt/stuck", "/tmp"], "/mnt/stuck");
  assert.notEqual(status, 0);
  assert.ok(!lines.some((line) => line.startsWith("setpriv")), "the agent did not start");
  assert.ok(!lines.some((line) => line.endsWith(" /tmp")), "the setup stopped at the failure");
});

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
  writeFileSync(join(repo, "pipe"), "p\n");
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
    // Git ignores an untracked FIFO, so only a tracked path reaches collection.
    "rm pipe && mkfifo pipe",
    "ln -s /etc/shadow leak.txt",
    "mkdir -p .codeman && ln -s /etc/shadow .codeman/output.json",
    `echo '{"ok":1}' > .codeman/ok.json && mkfifo .codeman/pipe.json`,
    "sudo -n true 2>/dev/null && echo yes > sudo.txt",
    `cat /proc/${process.pid}/environ > environ.txt 2>/dev/null`,
    `[ -e /proc/${process.pid} ] && echo yes > pid.txt`,
    'echo "$OPENROUTER_API_KEY" > key.txt',
    "env > env.txt",
    `ls -A '${home}' >/dev/null 2>&1 && echo yes > home.txt`,
    `ls -A '${runnerTemp}' >/dev/null 2>&1 && echo yes > temp.txt`,
    "[ -w /var/run/docker.sock ] && echo yes > docker.txt",
    // Each directory of its PATH, and the trees GitHub's images leave writable by every user.
    'for dir in $(echo "$PATH" | tr : " ") /opt /usr/share /usr/local/bin; do',
    '  touch "$dir/codeman-probe" 2>/dev/null && echo "$dir" >> wrote.txt',
    "done",
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
  assert.deepEqual(
    byPath.get("pipe"),
    { path: "pipe", status: "modified", type: "other" },
    "a FIFO is listed as other",
  );
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
  assert.ok(!byPath.has("pid.txt"), "the agent cannot see the runner's processes");
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
  assert.ok(!byPath.has("wrote.txt"), "the agent cannot add programs that run outside the sandbox");

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

// GitHub's images leave /opt/pipx_bin and /usr/local/bin writable by every user, first on the
// job's PATH and in sudo's secure_path. The jail keeps them read-only for the agent, without
// changing them for anyone else.
test("the agent cannot plant programs that run outside its jail", {
  skip: !enabled,
  timeout: 120_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codeman-planted-"));
  const marker = join(root, "ran");
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "README.md"), "hello\n");
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      ...args,
    ]);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");

  const asRoot = (...args: string[]) => execFileSync("/usr/bin/sudo", ["-n", "--", ...args]);
  const planted = ["/opt/pipx_bin/sudo", "/usr/local/bin/git"];
  for (const file of planted) {
    assert.ok(!existsSync(file), `${file} is not the runner's own`);
    asRoot("/usr/bin/mkdir", "-p", dirname(file));
    asRoot("/usr/bin/chmod", "0777", dirname(file));
  }
  try {
    createAgentUser();
    const worktree = `${AGENT_HOME}/work`;
    copyToAgent(repo, worktree);

    const started = Date.now();
    const idle = await runAsAgent(
      { file: "/bin/true", args: [], env: {} },
      worktree,
      60_000,
      new FakeRuntime(),
    );
    assert.deepEqual(idle, { exitCode: 0, timedOut: false });
    t.diagnostic(`A harness that does nothing ran in the jail in ${Date.now() - started} ms.`);

    const plant = planted
      .map(
        (file) =>
          `printf '#!/bin/sh\\necho "$0" >> ${marker}\\n' > ${file} && chmod 755 ${file} && echo ${file} >> planted.txt`,
      )
      .join("\n");
    const run = await runAsAgent(
      { file: "/bin/bash", args: ["-c", `echo changed >> README.md\n${plant}\nexit 0`], env: {} },
      worktree,
      60_000,
      new FakeRuntime(),
    );
    assert.deepEqual(run, { exitCode: 0, timedOut: false });
    sealAgentSandbox(worktree);
    const changes = collectChanges({
      gitDir: join(repo, ".git"),
      worktree,
      outDir: join(root, "result"),
      exclude: [],
    });
    assert.deepEqual(
      changes.map(({ path, status }) => ({ path, status })),
      [{ path: "README.md", status: "modified" }],
      "the agent planted nothing",
    );
    for (const file of planted) {
      assert.ok(!existsSync(file), `${file} was not created`);
      assert.notEqual(lstatSync(dirname(file)).mode & 0o002, 0, `${dirname(file)} is unchanged`);
    }
    assert.ok(!existsSync(marker), "no planted program ran");
  } finally {
    asRoot("/usr/bin/rm", "-f", "--", ...planted);
  }
});

// The jail shares the network, and the system's services run outside it. Through each one the
// agent tries to run a command that leaves a marker in a directory only the host's /tmp holds:
// inside the jail, /tmp is a new tmpfs, so a marker means the command ran outside.
// See docs/plans/2026-10-19-jail-the-agent-in-a-read-only-mount-namespace.md, step 3.
test("the agent cannot run a command outside its jail through the system's services", {
  skip: !enabled,
  timeout: 120_000,
}, async (t) => {
  const escaped = mkdtempSync("/tmp/codeman-escaped-");
  chmodSync(escaped, 0o777);
  const asRoot = (...args: string[]) =>
    spawnSync("/usr/bin/sudo", ["-n", "--", ...args], { encoding: "utf8" });
  createAgentUser();
  const worktree = `${AGENT_HOME}/work`;
  asRoot("/usr/bin/mkdir", "-p", worktree);
  asRoot("/usr/bin/chown", `${AGENT_USER}:${AGENT_USER}`, worktree);
  try {
    const script = [
      // Prints the route, then whether its program is missing, or its exit code and last line.
      "attempt() {",
      "  local route=$1 name=$2; shift 2",
      '  if ! command -v "$name" >/dev/null; then echo "route $route: $name is missing"; return; fi',
      '  local out; out=$("$@" 2>&1 </dev/null); local code=$?',
      '  echo "route $route: exit $code: $(printf %s "$out" | tail -n 1)"',
      "}",
      // sshd runs a command through the login shell, nologin; sftp's subsystem too, unless
      // sshd serves it in process.
      "mkdir -p ~/.ssh && chmod 700 ~/.ssh",
      "ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/probe >/dev/null 2>&1",
      "cat ~/.ssh/probe.pub >> ~/.ssh/authorized_keys 2>/dev/null; chmod 600 ~/.ssh/authorized_keys",
      `printf 'put /etc/hostname ${escaped}/sftp\\n' > ~/sftp.batch`,
      'ssh_opts="-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no' +
        ' -o UserKnownHostsFile=/dev/null -i $HOME/.ssh/probe"',
      `attempt ssh ssh ssh $ssh_opts ${AGENT_USER}@localhost touch ${escaped}/ssh`,
      `attempt sftp sftp sftp $ssh_opts -b $HOME/sftp.batch ${AGENT_USER}@localhost`,
      `attempt cron crontab bash -c "echo '* * * * * touch ${escaped}/cron' | crontab -"`,
      `attempt at at bash -c "echo 'touch ${escaped}/at' | at now"`,
      // Over the system bus, which the jail hides: a transient unit, and lingering, which polkit
      // grants any user and would start a systemd manager for the agent outside the jail.
      "attempt systemd systemd-run systemd-run --no-ask-password --unit=codeman-probe" +
        ` -- /usr/bin/touch ${escaped}/systemd`,
      `attempt linger loginctl loginctl --no-ask-password enable-linger ${AGENT_USER}`,
      "[ -e /run/dbus/system_bus_socket ] && echo 'route bus: visible in the jail'",
      // Abstract Unix sockets have no file, so read-only mounts do not reach them. List the bound,
      // unconnected ones in the shared network namespace.
      `awk 'NR > 1 && $6 == "01" && substr($8, 1, 1) == "@" { print "abstract " $8 }' /proc/net/unix | sort -u`,
      "exit 0",
    ].join("\n");
    const runtime = new FakeRuntime();
    const run = await runAsAgent(
      { file: "/bin/bash", args: ["-c", script], env: {} },
      worktree,
      60_000,
      runtime,
    );
    assert.deepEqual(run, { exitCode: 0, timedOut: false });
    const lines = runtime.logged("info").map((line) => line.replace(/^│ /, ""));
    for (const line of lines.filter((line) => line.startsWith("route "))) t.diagnostic(line);

    // A job of `at now` or a transient unit would run within a second or two.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    assert.deepEqual(readdirSync(escaped), [], "no command the agent started ran outside its jail");
    const scheduled = existsSync("/var/spool/cron")
      ? asRoot("/usr/bin/find", "/var/spool/cron", "-user", AGENT_USER).stdout.trim()
      : "";
    assert.equal(scheduled, "", "the agent scheduled nothing with cron or at");
    assert.ok(!existsSync(`/var/lib/systemd/linger/${AGENT_USER}`), "the agent does not linger");
    assert.ok(!lines.includes("route bus: visible in the jail"), "the jail hides the system bus");

    // Each listener here must be reviewed: what it is, and why the agent's connection to it cannot
    // run anything outside the jail. Names may hold patterns, for parts that change between runs.
    const known: RegExp[] = [
      // multipathd: only `list` and `show` for a client that is not root, by SO_PEERCRED
      // (docs/web/ubuntu/multipath-tools-0-9-4-5ubuntu8-2-source-package.md).
      /^@\/org\/kernel\/linux\/storage\/multipathd$/,
      // iscsid's management socket: refuses any client that is not root, by SO_PEERCRED
      // (docs/web/ubuntu/open-iscsi-2-1-9-3ubuntu5-5-source-package.md).
      /^@ISCSIADM_ABSTRACT_NAMESPACE$/,
    ];
    const sockets = lines
      .filter((line) => line.startsWith("abstract "))
      .map((line) => line.slice("abstract ".length));
    t.diagnostic(`Abstract Unix sockets: ${sockets.join(", ") || "none"}.`);
    const unknown = sockets.filter((name) => !known.some((pattern) => pattern.test(name)));
    const owners = existsSync("/usr/bin/ss")
      ? asRoot("/usr/bin/ss", "-xlpn")
          .stdout.split("\n")
          .filter((line) => unknown.some((name) => line.includes(name)))
      : [];
    assert.deepEqual(unknown, [], `Unreviewed abstract Unix sockets:\n${owners.join("\n")}`);
  } finally {
    sealAgentSandbox(worktree);
    asRoot("/usr/bin/rm", "-rf", "--", escaped, `${AGENT_HOME}/.ssh`, `${AGENT_HOME}/sftp.batch`);
  }
});
