import { spawn, spawnSync } from "node:child_process";
import { lstatSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { HarnessCommand } from "./harness/harness.ts";
import type { Log } from "./runtime/runtime.ts";
import { truncate } from "./text.ts";

/**
 * The agent runs as this user, which has no `sudo`. It cannot read the runner's processes, so it
 * cannot reach the job's tokens or the secrets of other steps. Linux runners only.
 */
export const AGENT_USER = "codeman-agent";
export const AGENT_HOME = `/home/${AGENT_USER}`;
/** The base of the agent's own PATH. Codeman never looks a program up in it. */
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Where Codeman finds the programs it runs around the agent: on Ubuntu, only root writes here.
 * Never the job's PATH, whose directories every user may write, such as /opt/pipx_bin and
 * /usr/local/bin on GitHub's images; nor sudo's secure_path, which starts with /usr/local/bin.
 */
export const TRUSTED_DIRS = ["/usr/bin", "/usr/sbin", "/bin", "/sbin"] as const;

/** What `untrustedReason` reads of the file system, so tests can give a fake one. */
export interface FileStats {
  lstat(path: string): { uid: number; mode: number; isSymbolicLink(): boolean } | undefined;
  readlink(path: string): string;
}

export const realFileStats: FileStats = {
  lstat: (path) => lstatSync(path, { throwIfNoEntry: false }),
  readlink: (path) => readlinkSync(path),
};

type Stats = NonNullable<ReturnType<FileStats["lstat"]>>;

const MAX_LINKS = 40;

/**
 * The components on the way to `path`, from `/`, links followed: each link, then the components of
 * its target. `missing` is the first component that does not exist, with the directory it would be
 * in; `loop` is set past MAX_LINKS links.
 */
function walk(
  path: string,
  fs: FileStats,
): {
  steps: { path: string; stats: Stats }[];
  missing?: { path: string; parent: string };
  loop?: true;
} {
  const root = fs.lstat("/");
  if (!root) return { steps: [], missing: { path: "/", parent: "/" } };
  const steps = [{ path: "/", stats: root }];
  const parts = (text: string) => text.split("/").filter((part) => part !== "" && part !== ".");
  let pending = parts(path);
  let current = "";
  let links = 0;
  while (pending.length > 0) {
    const part = pending.shift() as string;
    if (part === "..") {
      current = current.slice(0, current.lastIndexOf("/"));
      continue;
    }
    const entry = `${current}/${part}`;
    const stats = fs.lstat(entry);
    if (!stats) return { steps, missing: { path: entry, parent: current || "/" } };
    steps.push({ path: entry, stats });
    if (stats.isSymbolicLink()) {
      if (++links > MAX_LINKS) return { steps, loop: true };
      const target = fs.readlink(entry);
      if (target.startsWith("/")) current = "";
      pending = [...parts(target), ...pending];
      continue;
    }
    current = entry;
  }
  return { steps };
}

/**
 * Why only root does not control `path`, or undefined when it does: root owns `/`, every
 * component on the way to `path` and the file itself, links followed, and neither the group nor
 * other users can write any of them.
 */
export function untrustedReason(path: string, fs: FileStats): string | undefined {
  const { steps, missing, loop } = walk(path, fs);
  if (loop) return `${path} goes through more than ${MAX_LINKS} links`;
  for (const { path: entry, stats } of steps) {
    if (stats.uid !== 0) return `${entry} is not owned by root`;
    if (!stats.isSymbolicLink() && (stats.mode & 0o022) !== 0) {
      return `${entry} is writable by others than root`;
    }
  }
  return missing && `${missing.path} does not exist`;
}

/**
 * The first `<dir>/<name>` of TRUSTED_DIRS that exists and that only root controls. Throws,
 * naming the program, when none does.
 */
export function findProgram(name: string, fs: FileStats): string {
  if (name === "" || name.includes("/")) throw new Error(`Not a program name: ${name}`);
  const reasons: string[] = [];
  for (const dir of TRUSTED_DIRS) {
    const candidate = `${dir}/${name}`;
    if (!fs.lstat(candidate)) continue;
    const reason = untrustedReason(candidate, fs);
    if (reason === undefined) return candidate;
    reasons.push(reason);
  }
  throw new Error(
    `Codeman runs ${name} only from ${TRUSTED_DIRS.join(", ")}, owned by root and writable by no other user. This runner has none${reasons.length > 0 ? `: ${reasons.join("; ")}` : ""}.`,
  );
}

const programs = new Map<string, string>();

/** The trusted path of a program, from `findProgram` on the real file system, once per name. */
export function program(name: string): string {
  let path = programs.get(name);
  if (path === undefined) {
    path = findProgram(name, realFileStats);
    programs.set(name, path);
  }
  return path;
}

/** `program(name)`, or undefined when the runner lacks it, for a best-effort command. */
function optionalProgram(name: string): string | undefined {
  try {
    return program(name);
  } catch {
    return undefined;
  }
}

/** The programs the agent job always needs; checked before the agent starts. */
const REQUIRED_PROGRAMS = [
  "sudo",
  "id",
  "useradd",
  "usermod",
  "chown",
  "chmod",
  "install",
  "rm",
  "cp",
  "mkdir",
  "tee",
  "pkill",
  "pgrep",
  "git",
  "test",
  "env",
  "find",
  "realpath",
  "bash",
  "sh",
  "unshare",
  "mount",
  "findmnt",
  "setpriv",
];

/**
 * The arguments of `sudo` that run `name` as `user` (root by default), the command named by its
 * trusted path: sudo would otherwise look it up in its secure_path.
 */
export function sudoArgs(
  name: string,
  args: readonly string[],
  user?: string,
  resolve: (name: string) => string = program,
): string[] {
  return ["-n", ...(user ? ["-u", user] : []), "--", resolve(name), ...args];
}

function runSudo(name: string, args: readonly string[], user?: string, input?: string) {
  return spawnSync(program("sudo"), sudoArgs(name, args, user), {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function checkedSudo(name: string, args: readonly string[], user?: string, input?: string) {
  const result = runSudo(name, args, user, input);
  if (result.status !== 0) {
    throw new Error(`sudo ${name} failed: ${truncate((result.stderr ?? "").trim(), 500)}`);
  }
  return result.stdout;
}

/** Runs a program as root and returns its status and stdout, without throwing on a failure. */
export function sudoCapture(
  name: string,
  args: readonly string[],
): { status: number | null; stdout: string } {
  const result = runSudo(name, args);
  return { status: result.status, stdout: result.stdout ?? "" };
}

/** Runs a program as `user`, and returns its stdout; throws if it fails. */
export function sudoAs(
  user: string,
  name: string,
  args: readonly string[],
  input?: string,
): string {
  return checkedSudo(name, args, user, input);
}

/** Runs a program as root, and returns its stdout; throws if it fails. */
export function sudo(name: string, args: readonly string[], input?: string): string {
  return checkedSudo(name, args, undefined, input);
}

/** The agent's login shell: `sshd` and `su` run no command for it. */
const NOLOGIN = "/usr/sbin/nologin";

/**
 * Creates the agent's user, and closes the runner's home to other users: it holds the job's
 * temporary files, the workspace and tool configuration. First checks that every program the
 * job needs is where only root can change it, so a runner that lacks one fails before the run
 * reaches its model. The image's world-writable paths stay as they are: the agent runs in a
 * jail where they are read-only (see `jailScript`).
 */
export function createAgentUser(): void {
  for (const name of REQUIRED_PROGRAMS) program(name);
  if (spawnSync(program("id"), ["-u", AGENT_USER]).status !== 0) {
    sudo("useradd", ["--create-home", "--shell", NOLOGIN, AGENT_USER]);
  }
  sudo("usermod", ["--shell", NOLOGIN, AGENT_USER]);
  // Give the home back to the agent, in case a previous run's collection took it away.
  sudo("chown", [`${AGENT_USER}:${AGENT_USER}`, AGENT_HOME]);
  sudo("chmod", ["700", AGENT_HOME]);
  sudo("chmod", ["o-rwx", homedir()]);
}

/** Installs an executable that the agent can run but not change. */
export function installForAgent(source: string, name: string): string {
  const target = `/opt/codeman/${name}`;
  sudo("install", ["-D", "-m", "0755", source, target]);
  return target;
}

/**
 * Copies `source` to `target`, for the agent, without the paths of `exclude` (relative to
 * `source`, with `/` separators), which are removed before the agent can see them.
 */
export function copyToAgent(source: string, target: string, exclude: readonly string[] = []): void {
  for (const path of exclude) {
    if (path.startsWith("/") || path.split("/").some((part) => ["", ".", ".."].includes(part))) {
      throw new Error(`Cannot leave out ${path}: not a path inside the copy.`);
    }
  }
  sudo("rm", ["-rf", target]);
  sudo("cp", ["-a", source, target]);
  for (const path of exclude) sudo("rm", ["-rf", "--", `${target}/${path}`]);
  sudo("chown", ["-R", `${AGENT_USER}:${AGENT_USER}`, target]);
}

export function writeAsAgent(file: string, content: string): void {
  sudoAs(AGENT_USER, "mkdir", ["-p", file.slice(0, file.lastIndexOf("/"))]);
  sudoAs(AGENT_USER, "tee", [file], content);
}

/** Sends `signal` to every process of the agent, in the jail or not. */
function signalAgentProcesses(signal: "TERM" | "KILL"): void {
  spawnSync(program("sudo"), sudoArgs("pkill", [`-${signal}`, "-u", AGENT_USER]));
}

/** Stops every process the agent left behind, so nothing changes files while they are collected. */
export function killAgentProcesses(): void {
  signalAgentProcesses("KILL");
}

/**
 * Runs a program as `user` (root by default) that is allowed to fail, or to be missing, as on a
 * runner that lacks the tool.
 */
function trySudo(name: string, args: readonly string[], user?: string): void {
  if (optionalProgram(name) === undefined) return;
  spawnSync(program("sudo"), sudoArgs(name, args, user), { stdio: "ignore" });
}

/** Waits `ms` milliseconds, without running a program. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Seals the agent out before collection: stops everything it could still run, and takes its home
 * and work tree away from it, so no process it left can change a path while root reads it.
 *
 * The kill after the harness does not reach work the agent scheduled for later (cron, `at`, a
 * systemd user service kept alive by lingering). Each stop is best-effort: a runner may lack
 * `at` or `loginctl`. The agent owns its home, so until root owns it the agent could rename an
 * entry and put a symlink in its place; `chown` without `-L` never follows a link out.
 */
export function sealAgentSandbox(worktree: string): void {
  trySudo("crontab", ["-r", "-u", AGENT_USER]);
  // List and remove the agent's own `at` jobs, as the agent, tolerating a missing `at`. These
  // programs run as the agent, which gains nothing from planting them.
  trySudo("bash", ["-c", "atq 2>/dev/null | awk '{print $1}' | xargs -r atrm"], AGENT_USER);
  trySudo("loginctl", ["disable-linger", AGENT_USER]);
  // Kills the whole user slice, including a systemd user manager and its timers.
  trySudo("loginctl", ["terminate-user", AGENT_USER]);
  trySudo("usermod", ["-L", "-s", NOLOGIN, AGENT_USER]);
  // Kill, then wait briefly for the processes to be gone; a signalled process may still be dying.
  let alive = true;
  for (let attempt = 0; alive && attempt < 20; attempt++) {
    killAgentProcesses();
    alive = spawnSync(program("sudo"), sudoArgs("pgrep", ["-u", AGENT_USER])).status === 0;
    if (alive) pause(100);
  }
  if (alive) {
    throw new Error("A process of the agent survived; refusing to collect from a live sandbox.");
  }
  // After this, the agent owns neither its home nor its work tree, so it cannot swap any path.
  sudo("chown", ["-h", "root:root", AGENT_HOME]);
  sudo("chown", ["-R", "-h", "root:root", worktree]);
}

/**
 * The job's PATH, so the agent can use the runner's tools and those set up by earlier steps,
 * without entries in the runner's home, which the agent cannot read.
 */
export function agentPath(jobPath: string, runnerHome: string): string {
  const entries = [...jobPath.split(":"), ...SAFE_PATH.split(":")].filter(
    (entry) =>
      entry.startsWith("/") &&
      !entry.includes("'") &&
      entry !== runnerHome &&
      !entry.startsWith(`${runnerHome}/`),
  );
  return [...new Set(entries)].join(":");
}

/** The agent's whole environment, besides the harness's own variables. */
export function agentEnv(path: string): Record<string, string> {
  return {
    HOME: AGENT_HOME,
    USER: AGENT_USER,
    LOGNAME: AGENT_USER,
    SHELL: "/bin/bash",
    PATH: path,
    LANG: "C.UTF-8",
    TMPDIR: "/tmp",
    XDG_CONFIG_HOME: `${AGENT_HOME}/.config`,
    XDG_DATA_HOME: `${AGENT_HOME}/.local/share`,
    XDG_STATE_HOME: `${AGENT_HOME}/.local/state`,
    XDG_CACHE_HOME: `${AGENT_HOME}/.cache`,
  };
}

/**
 * Runs as the agent, in the jail: drops every exported variable except the harness's (sudo's PAM
 * session adds the runner's /etc/environment, whose paths point into the runner's home), sets `env`,
 * enters the directory and runs the command. Arguments: kept names, directory, command.
 * Secrets stay in the environment, never in argv. Values must not contain `'`.
 */
export function launcher(env: Record<string, string>): string {
  return `keep=" $1 "; shift
for name in $(compgen -e); do
  case "$keep" in *" $name "*) ;; *) unset "$name" 2>/dev/null ;; esac
done
export ${Object.entries(env)
    .map(([name, value]) => `${name}='${value}'`)
    .join(" ")}
cd "$1" || exit 1; shift
exec "$@"`;
}

/**
 * The jail's setup, run by `bash` as root in new mount, PID and IPC namespaces (see `jailArgs`).
 * It remounts every mount read-only, so the agent cannot change a file that runs outside the jail,
 * such as a program in the image's world-writable /opt/pipx_bin or /usr/local/bin. /proc gets a
 * new procfs, for the new PID namespace, and /tmp, /var/tmp and /dev/shm new tmpfs. Only the
 * agent's home, which holds its work tree, stays writable. An empty tmpfs hides /run/dbus, where
 * one is: a read-only mount still lets a socket be connected to, and over the system bus polkit
 * lets any user linger, which starts a systemd manager for it outside the jail. It fails closed on
 * any error.
 *
 * Then it runs the launcher as the agent, with `no_new_privs` and no capability. Root's shell stays
 * PID 1 of the namespace: it reaps orphans, and when the harness exits, the kernel kills every
 * process left in the namespace. Arguments: the launcher, then the launcher's own.
 */
export function jailScript(resolve: (name: string) => string = program): string {
  const mount = resolve("mount");
  return `set -euo pipefail
targets=$(${resolve("findmnt")} -rn -o TARGET)
while IFS= read -r target; do
  target=$(printf '%b' "$target")
  case "$target" in /proc | /proc/*) continue ;; esac
  ${mount} -o remount,bind,ro "$target"
done <<< "$targets"
${mount} -t proc -o nosuid,nodev,noexec proc /proc
for dir in /tmp /var/tmp /dev/shm; do
  ${mount} -t tmpfs -o mode=1777,nosuid,nodev tmpfs "$dir"
done
if [ -d /run/dbus ]; then ${mount} -t tmpfs -o mode=755,nosuid,nodev,noexec tmpfs /run/dbus; fi
${mount} --bind ${AGENT_HOME} ${AGENT_HOME}
${mount} -o remount,bind,rw,nosuid,nodev ${AGENT_HOME}
launcher=$1; shift
${resolve("setpriv")} --reuid=${AGENT_USER} --regid=${AGENT_USER} --init-groups --no-new-privs \
  --inh-caps=-all --bounding-set=-all -- ${resolve("bash")} -c "$launcher" ${AGENT_USER} "$@"
exit $?`;
}

/**
 * The arguments of `sudo` that run `command` as the agent, in `cwd`, in the jail: new mount, PID
 * and IPC namespaces, the network shared, so the agent reaches its model and the loopback gateway.
 * `unshare` waits for the jail and ignores SIGTERM: stop the agent's processes instead.
 */
export function jailArgs(
  command: HarnessCommand,
  cwd: string,
  launcherScript: string,
  resolve: (name: string) => string = program,
): string[] {
  const keep = Object.keys(command.env);
  return [
    "-n",
    `--preserve-env=${keep.join(",")}`,
    "--",
    resolve("unshare"),
    "--mount",
    "--pid",
    "--ipc",
    "--fork",
    "--kill-child",
    "--propagation",
    "private",
    "--",
    resolve("bash"),
    "-c",
    jailScript(resolve),
    "codeman-jail",
    launcherScript,
    keep.join(" "),
    cwd,
    command.file,
    ...command.args,
  ];
}

/**
 * Runs the harness as the agent, until it exits, its time is up, or `stop` is aborted, as when
 * its model can no longer be reached; `stopped` then holds the reason.
 */
export async function runAsAgent(
  command: HarnessCommand,
  cwd: string,
  timeoutMs: number,
  log: Log,
  stop?: AbortSignal,
): Promise<{ exitCode: number | null; timedOut: boolean; stopped?: string }> {
  const args = jailArgs(
    command,
    cwd,
    launcher(agentEnv(agentPath(process.env.PATH ?? "", homedir()))),
  );
  const child = spawn(program("sudo"), args, {
    env: { PATH: process.env.PATH ?? SAFE_PATH, ...command.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Agent output is untrusted: prefix every line so it cannot issue workflow commands.
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => log.info(`│ ${truncate(line, 4000)}`));
  }

  // SIGTERM to the agent's processes, each second for 10 seconds, then SIGKILL, until the jail
  // exits: unshare ignores SIGTERM, and the harness may not have started yet.
  let stopper: ReturnType<typeof setInterval> | undefined;
  const end = () => {
    if (stopper) return;
    const ended = Date.now();
    signalAgentProcesses("TERM");
    stopper = setInterval(
      () => signalAgentProcesses(Date.now() - ended < 10_000 ? "TERM" : "KILL"),
      1_000,
    );
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log.warning(`The agent reached its time limit of ${Math.round(timeoutMs / 60_000)} minutes.`);
    end();
  }, timeoutMs);
  let stopped: string | undefined;
  const onStop = () => {
    const reason: unknown = stop?.reason;
    stopped = reason instanceof Error ? reason.message : String(reason);
    log.warning(`The agent was stopped: ${stopped}`);
    end();
  };
  if (stop?.aborted) onStop();
  else stop?.addEventListener("abort", onStop, { once: true });

  // `exit`, not `close`: processes the agent left in the background may keep the pipes open.
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  clearInterval(stopper);
  stop?.removeEventListener("abort", onStop);
  return stopped === undefined ? { exitCode, timedOut } : { exitCode, timedOut, stopped };
}
