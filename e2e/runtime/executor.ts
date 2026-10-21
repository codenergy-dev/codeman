import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { docker, dockerOk, envArgs, imagePath } from "./docker.ts";
import type {
  Command,
  CommandResult,
  JobExecutor,
  JobSession,
  JobStart,
} from "./simulator/executor.ts";

/**
 * The jobs' runner for the e2e suite: each job in its own container of the e2e runner image, on
 * the internal jobs network only, so a job reaches the fakes and nothing else. As
 * docs/development/local-actions.md runs the local runner, with `--init`, `SYS_ADMIN` and
 * seccomp and AppArmor unconfined, which the agent's jail needs. The job's directory is mounted
 * where the runner keeps it (`/home/runner/work`), the session's CA on `/etc/codeman-e2e`, and
 * e2e/.build/ with AGENTS.md and the web tool's page for `uses: ./`, which the job copies into its
 * checkout of Codeman as `dist/`, so the bundle sees the action's own directory as on GitHub.
 */

/** Where the job sees its directory, as on GitHub's runners. */
export const JOB_ROOT = "/home/runner/work";
/** Where the bundle's files are mounted, read-only. */
export const BUNDLE_ROOT = "/opt/codeman-e2e";
/** The runner's Node, as GitHub runs JavaScript actions with its own, not the job's `PATH`'s. */
const ACTION_NODE = "/opt/hostedtoolcache/node/24.21.0/x64/bin/node";

export interface DockerExecutorOptions {
  image: string;
  /** The internal network: `codeman-e2e-jobs`. */
  network: string;
  /** The volume of the session's CA: `codeman-e2e-ca`. */
  caVolume: string;
  /** Host paths: the e2e bundle's directory, AGENTS.md, and docs/web/tools/. */
  bundle: { dir: string; rules: string; tools: string };
  /** Every job's machine environment, such as `CODEMAN_E2E_ENDPOINTS` and `GH_HOST`. */
  env: Record<string, string>;
  /** Labels on each container, so a scenario's end removes them. */
  labels: Record<string, string>;
  /** A job's memory limit, such as `3g`. */
  memory?: string;
  /** Called with each container's name, when it starts. */
  started?(job: JobStart, container: string): void;
}

export class DockerExecutor implements JobExecutor {
  readonly #options: DockerExecutorOptions;
  #path: Promise<string> | undefined;

  constructor(options: DockerExecutorOptions) {
    this.#options = options;
  }

  async start(job: JobStart): Promise<JobSession> {
    const options = this.#options;
    this.#path ??= imagePath(options.image);
    const path = await this.#path;
    const name = `codeman-e2e-job-${job.runId}-${randomBytes(4).toString("hex")}`;
    const labels = Object.entries({ ...options.labels, "codeman-e2e.job": job.name }).flatMap(
      ([key, value]) => ["--label", `${key}=${value}`],
    );
    await dockerOk([
      "run",
      "--detach",
      "--init",
      "--name",
      name,
      ...labels,
      "--network",
      options.network,
      "--cap-add",
      "SYS_ADMIN",
      "--security-opt",
      "seccomp=unconfined",
      "--security-opt",
      "apparmor=unconfined",
      ...(options.memory ? ["--memory", options.memory, "--memory-swap", options.memory] : []),
      "--volume",
      `${job.hostRoot}:${JOB_ROOT}`,
      "--volume",
      `${options.caVolume}:/etc/codeman-e2e:ro`,
      "--volume",
      `${options.bundle.dir}:${BUNDLE_ROOT}/dist:ro`,
      "--volume",
      `${options.bundle.rules}:${BUNDLE_ROOT}/AGENTS.md:ro`,
      "--volume",
      `${options.bundle.tools}:${BUNDLE_ROOT}/docs/web/tools:ro`,
      "--entrypoint",
      "sleep",
      options.image,
      "infinity",
    ]);
    options.started?.(job, name);
    // The image's entry point, which adds the CA to the system store git and gh read.
    const trusted = await docker(["exec", name, "/usr/sbin/trust-e2e-ca"]);
    if (trusted.exitCode !== 0) {
      await docker(["rm", "-f", name]);
      throw new Error(`The job's container could not trust the session's CA: ${trusted.stderr}`);
    }
    let stopped = false;
    let steps = 0;
    return {
      root: JOB_ROOT,
      exec: (command) =>
        stopped
          ? Promise.resolve({ exitCode: 125, output: "The job's container was stopped.\n" })
          : this.#exec(name, path, command, ++steps),
      stop: async () => {
        stopped = true;
        await docker(["rm", "-f", name]);
      },
    };
  }

  #exec(container: string, imagePathValue: string, command: Command, step: number) {
    // A step that would start after its job was cancelled does not run, as on GitHub.
    if (command.signal.aborted) {
      return Promise.resolve<CommandResult>({ exitCode: 1, output: "" });
    }
    const env: Record<string, string> = { ...this.#options.env, ...command.env };
    // gh takes its token from GH_ENTERPRISE_TOKEN for a host other than github.com.
    if (env.GH_TOKEN !== undefined && env.GH_ENTERPRISE_TOKEN === undefined) {
      env.GH_ENTERPRISE_TOKEN = env.GH_TOKEN;
    }
    const pathValue = [...command.path, imagePathValue].filter(Boolean).join(":");
    delete env.PATH;
    delete env.HOME;
    const passed = envArgs(env);
    const argv = command.kind === "run" ? command.argv : actionArgv(env.GITHUB_ACTION_PATH);
    const pidFile = `/tmp/codeman-e2e-step-${step}.pid`;
    const args = [
      "exec",
      "--workdir",
      command.cwd,
      "--env",
      `PATH=${pathValue}`,
      "--env",
      "HOME=/home/runner",
      ...passed.args,
      container,
      ...stepArgv(pidFile, argv),
    ];
    return new Promise<CommandResult>((resolve) => {
      const chunks: Buffer[] = [];
      let timedOut = false;
      let stopping: Promise<unknown> | undefined;
      let closed = false;
      // Stopping the CLI leaves the process in the container: the step's processes are signalled
      // inside it, as GitHub's runner signals them, and the container stays for the steps after.
      const stop = () => {
        if (stopping) return;
        stopping = stopStep(
          (signal) => signalStep(container, pidFile, signal),
          () => closed,
        );
        void stopping.then(async () => {
          // A process the step left holding the CLI's output would keep it open.
          await sleep(CLI_GRACE_MS);
          if (!closed) child.kill("SIGKILL");
        });
      };
      const child = spawn("docker", args, {
        env: { ...process.env, ...passed.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer =
        command.timeoutMs < MAX_TIMER_MS
          ? setTimeout(() => {
              timedOut = true;
              stop();
            }, command.timeoutMs)
          : undefined;
      command.signal.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
      const done = (exitCode: number, extra = "") => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        command.signal.removeEventListener("abort", stop);
        const result: CommandResult = {
          exitCode,
          output: Buffer.concat(chunks).toString("utf8") + extra,
          ...(timedOut ? { timedOut } : {}),
        };
        // A stopped step ends once what it left running was killed too.
        if (stopping) void stopping.then(() => resolve(result));
        else resolve(result);
      };
      child.on("error", (error) => done(127, `${error.message}\n`));
      child.on("close", (code) => done(code ?? 1));
    });
  }
}

/** The longest delay `setTimeout` keeps; a longer one would fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** How long the CLI may stay open once the step's processes were killed. */
const CLI_GRACE_MS = 5_000;

/**
 * A step's argv, recording its process ID in `pidFile` first, so it can be signalled. bash, not
 * sh: dash drops the variables whose names are not a shell's, such as `INPUT_TEMPLATE-VERSION`.
 */
export function stepArgv(pidFile: string, argv: string[]): string[] {
  return ["bash", "-c", 'echo $$ > "$0" && exec "$@"', pidFile, ...argv];
}

/**
 * Signals a step's processes inside its container, as root: `INT` and `TERM` to its first
 * process, `KILL` to every process that was under it at any signal, so what a process left
 * running when it died goes too.
 */
const SIGNAL_SCRIPT = [
  'root=$(cat "$1" 2>/dev/null) || exit 0',
  "level=$root",
  'while [ -n "$level" ]; do',
  '  echo "$level" >> "$1.tree"',
  '  next=""',
  '  for pid in $level; do next="$next $(ps -o pid= --ppid "$pid")"; done',
  "  level=$(echo $next)",
  "done",
  'if [ "$2" = KILL ]; then kill -KILL $(cat "$1.tree") 2>/dev/null; else kill -"$2" "$root" 2>/dev/null; fi',
  "exit 0",
].join("\n");

async function signalStep(container: string, pidFile: string, signal: StopSignal) {
  await docker(
    [
      "exec",
      "--user",
      "root",
      container,
      "sh",
      "-c",
      SIGNAL_SCRIPT,
      "codeman-e2e-stop",
      pidFile,
      signal,
    ],
    { timeoutMs: 20_000 },
  );
}

export type StopSignal = "INT" | "TERM" | "KILL";

/**
 * How GitHub's runner stops a cancelled or timed-out step's process: SIGINT, then SIGTERM after
 * 7.5 seconds, then, 2.5 seconds later, SIGKILL to its whole tree. It ends early once `ended`
 * says the process is gone.
 */
export async function stopStep(
  signal: (signal: StopSignal) => Promise<void>,
  ended: () => boolean,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<StopSignal[]> {
  const sent: StopSignal[] = [];
  const pause = async (ms: number) => {
    for (let left = ms; left > 0 && !ended(); left -= POLL_MS) await wait(Math.min(POLL_MS, left));
  };
  for (const [next, after] of [
    ["INT", 7_500],
    ["TERM", 2_500],
    ["KILL", 0],
  ] as const) {
    if (ended() && next !== "KILL") continue;
    await signal(next);
    sent.push(next);
    await pause(after);
  }
  return sent;
}

const POLL_MS = 250;

/**
 * Codeman's action: its bundle copied into the job's checkout of Codeman (`GITHUB_ACTION_PATH`),
 * as `actions/checkout` of Codeman leaves it there on GitHub, then run with the runner's Node.
 */
export function actionArgv(actionPath: string | undefined): string[] {
  if (!actionPath) return [ACTION_NODE, `${BUNDLE_ROOT}/dist/index.js`];
  const script = [
    "set -e",
    'a="$1"',
    'mkdir -p "$a/dist" "$a/docs/web/tools"',
    `cp ${BUNDLE_ROOT}/dist/index.js "$a/dist/index.js"`,
    `cp ${BUNDLE_ROOT}/AGENTS.md "$a/AGENTS.md"`,
    `cp ${BUNDLE_ROOT}/docs/web/tools/fetch-markdown.md "$a/docs/web/tools/fetch-markdown.md"`,
    `exec ${ACTION_NODE} "$a/dist/index.js"`,
  ].join("\n");
  return ["bash", "-c", script, "codeman-action", posix.normalize(actionPath)];
}
