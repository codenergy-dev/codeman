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
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { collectChanges, copyLiveAgentFile, copySealedAgentFile } from "./collect.ts";
import {
  AGENT_HOME,
  AGENT_USER,
  closeArgs,
  copyToAgent,
  createAgentUser,
  type FileStats,
  findProgram,
  killAgentProcesses,
  pathProblems,
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
    readdir: (path) => {
      if (!entries[path]) throw new Error(`No directory: ${path}`);
      const prefix = path === "/" ? "/" : `${path}/`;
      return Object.keys(entries)
        .filter((other) => other.startsWith(prefix) && !other.slice(prefix.length).includes("/"))
        .map((other) => other.slice(prefix.length))
        .filter((name) => name !== "");
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

test("a PATH is safe only when the agent can change none of its programs", () => {
  const problems = (path: string, extra: Record<string, FakeEntry> = {}) =>
    pathProblems(path, fakeFs({ ...ubuntu, ...extra }));
  assert.deepEqual(problems("/usr/local/bin:/usr/bin:/bin:relative"), []);
  assert.deepEqual(problems("/usr/local/bin:/usr/bin", { "/usr/local/bin": { mode: 0o777 } }), [
    "/usr/local/bin",
  ]);
  const pipx = { "/opt": { mode: 0o777 }, "/opt/pipx_bin": { mode: 0o755 } };
  assert.deepEqual(problems("/opt/pipx_bin:/usr/bin", pipx), ["/opt/pipx_bin"], "a parent");
  assert.deepEqual(
    problems("/usr/local/bin:/usr/bin", { "/usr/local/bin/git": { mode: 0o777 } }),
    ["/usr/local/bin"],
    "a file in the directory",
  );
  assert.deepEqual(
    problems("/usr/local/bin", {
      "/usr/local/bin/npm": { link: "../../../opt/npm/cli.js" },
      "/opt": { mode: 0o777 },
      "/opt/npm": { mode: 0o755 },
      "/opt/npm/cli.js": { mode: 0o755 },
    }),
    ["/usr/local/bin"],
    "a link to a file the agent can change",
  );
  assert.deepEqual(problems("/tmp/tools/bin"), ["/tmp/tools/bin"], "missing, under a sticky /tmp");
  assert.deepEqual(
    problems("/tmp/tools/bin", {
      "/tmp/tools": { uid: 1001, mode: 0o755 },
      "/tmp/tools/bin": { uid: 1001, mode: 0o755 },
    }),
    [],
    "under a sticky /tmp, in a directory of the runner's",
  );
  assert.deepEqual(problems("/usr/games", { "/usr": { mode: 0o777 } }), ["/usr/games"], "missing");
});

test("closing leaves links and sticky directories alone", () => {
  const args = closeArgs((name) => `/t/${name}`).join(" ");
  for (const part of [
    "/ -xdev",
    "-perm -0002",
    "-type f -o -type d ! -perm -1000",
    "-exec /t/chmod o-w -- {} +",
  ]) {
    assert.ok(args.includes(part), `${args} has ${part}`);
  }
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

  createAgentUser(new FakeRuntime());
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
  createAgentUser(new FakeRuntime());
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

  createAgentUser(new FakeRuntime());
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

test("the agent does not start when it could add programs to the job's PATH", {
  skip: !enabled,
  timeout: 300_000,
}, () => {
  const saved = process.env.PATH;
  // Missing, under the sticky /tmp: the agent could create it.
  const missing = `/tmp/codeman-missing-${process.pid}/bin`;
  process.env.PATH = `${missing}:${saved ?? ""}`;
  try {
    assert.throws(
      () => createAgentUser(new FakeRuntime()),
      (error: Error) => error.message.includes(`could add or change programs in ${missing},`),
    );
  } finally {
    process.env.PATH = saved;
  }
});

// Last: the planted `git` would otherwise reach this file's other tests. Other test files run
// alongside, so a stub runs the real program for them, and records only a run by Codeman's step,
// which carries CODEMAN_PLANTED, or by root, whose sudo drops it.
test("Codeman runs no program the agent could have planted, and closes their directories", {
  skip: !enabled,
  timeout: 300_000,
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

  // Where the agent could write them on GitHub's images: first on the job's PATH, and first in
  // sudo's secure_path. An earlier test closed the directories; open them again, as the image does.
  const asRoot = (...args: string[]) => execFileSync("/usr/bin/sudo", ["-n", "--", ...args]);
  const planted = ["/opt/pipx_bin/sudo", "/usr/local/bin/git"];
  for (const file of planted) {
    assert.ok(!existsSync(file), `${file} is not the runner's own`);
    const stub = join(root, basename(file));
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        'if [ -n "$CODEMAN_PLANTED" ] || [ "$(/usr/bin/id -u)" = 0 ]; then',
        `  echo "$0 $*" >> ${marker}`,
        "  exit 0",
        "fi",
        `exec /usr/bin/${basename(file)} "$@"`,
        "",
      ].join("\n"),
    );
    asRoot("/usr/bin/mkdir", "-p", dirname(file));
    asRoot("/usr/bin/chmod", "0777", dirname(file));
    asRoot("/usr/bin/install", "-m", "0755", stub, file);
  }
  process.env.CODEMAN_PLANTED = "1";
  try {
    let failure: unknown;
    try {
      const runtime = new FakeRuntime();
      createAgentUser(runtime);
      const closed = runtime.logged("info").find((line) => line.startsWith("Closed the runner's"));
      assert.ok(closed, "the closing's time is logged");
      t.diagnostic(closed);
      const worktree = `${AGENT_HOME}/work`;
      copyToAgent(repo, worktree);
      const run = await runAsAgent(
        { file: "/bin/bash", args: ["-c", "echo changed >> README.md"], env: {} },
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
      );
    } catch (error) {
      failure = error;
    }
    const ran = existsSync(marker) ? readFileSync(marker, "utf8") : "";
    assert.equal(ran, "", "Codeman ran none of the planted programs");
    if (failure) throw failure;
    for (const file of planted) {
      assert.equal(lstatSync(dirname(file)).mode & 0o002, 0, `${dirname(file)} is closed`);
    }
  } finally {
    delete process.env.CODEMAN_PLANTED;
    asRoot("/usr/bin/rm", "-f", "--", ...planted);
  }
});
