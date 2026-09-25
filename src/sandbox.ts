import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import * as core from "@actions/core";
import type { HarnessCommand } from "./harness/harness.ts";
import { truncate } from "./text.ts";

/**
 * The agent runs as this user, which has no `sudo`. It cannot read the runner's processes, so it
 * cannot reach the job's tokens or the secrets of other steps. Linux runners only.
 */
export const AGENT_USER = "codeman-agent";
export const AGENT_HOME = `/home/${AGENT_USER}`;
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export function sudo(args: readonly string[], input?: string): string {
  const result = spawnSync("sudo", ["-n", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`sudo ${args[0]} failed: ${truncate(result.stderr.trim(), 500)}`);
  }
  return result.stdout;
}

/**
 * Creates the agent's user, and closes the runner's home to other users: it holds the job's
 * temporary files, the workspace and tool configuration.
 */
export function createAgentUser(): void {
  if (spawnSync("id", ["-u", AGENT_USER]).status !== 0) {
    sudo(["useradd", "--create-home", "--shell", "/bin/bash", AGENT_USER]);
  }
  sudo(["chmod", "700", AGENT_HOME]);
  sudo(["chmod", "o-rwx", homedir()]);
}

/** Installs an executable that the agent can run but not change. */
export function installForAgent(source: string, name: string): string {
  const target = `/opt/codeman/${name}`;
  sudo(["install", "-D", "-m", "0755", source, target]);
  return target;
}

export function copyToAgent(source: string, target: string): void {
  sudo(["rm", "-rf", target]);
  sudo(["cp", "-a", source, target]);
  sudo(["chown", "-R", `${AGENT_USER}:${AGENT_USER}`, target]);
}

export function writeAsAgent(file: string, content: string): void {
  sudo(["-u", AGENT_USER, "mkdir", "-p", file.slice(0, file.lastIndexOf("/"))]);
  sudo(["-u", AGENT_USER, "tee", file], content);
}

/** Stops every process the agent left behind, so nothing changes files while they are collected. */
export function killAgentProcesses(): void {
  spawnSync("sudo", ["-n", "pkill", "-KILL", "-u", AGENT_USER]);
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
 * Runs as the agent: drops every exported variable except the harness's (sudo's PAM session
 * adds the runner's /etc/environment, whose paths point into the runner's home), sets `env`,
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

export async function runAsAgent(
  command: HarnessCommand,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  const keep = Object.keys(command.env);
  const args = [
    "-n",
    `--preserve-env=${keep.join(",")}`,
    "-u",
    AGENT_USER,
    "-H",
    "--",
    "/bin/bash",
    "-c",
    launcher(agentEnv(agentPath(process.env.PATH ?? "", homedir()))),
    "codeman-agent",
    keep.join(" "),
    cwd,
    command.file,
    ...command.args,
  ];
  const child = spawn("sudo", args, {
    env: { PATH: process.env.PATH ?? SAFE_PATH, ...command.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Agent output is untrusted: prefix every line so it cannot issue workflow commands.
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => core.info(`│ ${truncate(line, 4000)}`));
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    core.warning(`The agent reached its time limit of ${Math.round(timeoutMs / 60_000)} minutes.`);
    child.kill("SIGTERM");
    setTimeout(killAgentProcesses, 10_000).unref();
  }, timeoutMs);

  // `exit`, not `close`: processes the agent left in the background may keep the pipes open.
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  return { exitCode, timedOut };
}
