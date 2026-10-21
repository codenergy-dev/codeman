import { spawn } from "node:child_process";
import { delimiter } from "node:path";

/**
 * Where a job's processes run. The simulator owns each job's directory on the host and its
 * command files; the executor runs the job's `run:` steps and Codeman's bundle where the job
 * lives. Step 4.3's executor runs them in the e2e runner container, with the job's directory
 * mounted at `JobSession.root`; `ProcessExecutor` runs them on the host, and `RecordingExecutor`
 * runs nothing and records each command, for the simulator's tests.
 */

/** A job about to start. */
export interface JobStart {
  runId: number;
  /** The job's name, as GitHub shows it, such as `task (#1) / Open key`. */
  name: string;
  repository: string;
  /** The job's directory on the host: `_temp/` and the workspace are under it. */
  hostRoot: string;
}

export interface StepInfo {
  index: number;
  id?: string;
  name: string;
}

interface BaseCommand {
  /** The step's whole environment, but `PATH`. */
  env: Record<string, string>;
  /** Directories `GITHUB_PATH` added, to put before the job's own `PATH`, as the job sees them. */
  path: string[];
  /** As the job sees it. */
  cwd: string;
  step: StepInfo;
  /** Aborted when the run or the job is cancelled. */
  signal: AbortSignal;
  /** What remains of the step's and the job's time. */
  timeoutMs: number;
}

/** A `run:` step: the shell's argv, whose last argument is the script file, as the job sees it. */
export interface RunCommand extends BaseCommand {
  kind: "run";
  argv: string[];
  /** The script, with its expressions written in. */
  script: string;
}

/** Codeman's action: `node <entry>`, with `INPUT_*` in `env`. */
export interface ActionCommand extends BaseCommand {
  kind: "action";
  /** The bundle's path on the host, such as `e2e/.build/index.js`, made absolute. */
  entry: string;
  /** The action's inputs, as `with:` and the defaults of `action.yml` gave them. */
  inputs: Record<string, string>;
}

export type Command = RunCommand | ActionCommand;

export interface CommandResult {
  exitCode: number;
  /** stdout and stderr, as the log shows them; workflow commands are read from it. */
  output: string;
  timedOut?: boolean;
}

export interface JobSession {
  /** Where the job sees `JobStart.hostRoot`, such as `/home/runner/work`. */
  readonly root: string;
  exec(command: Command): Promise<CommandResult>;
  /** Ends the job; called once, whatever its result. */
  stop(): Promise<void>;
}

export interface JobExecutor {
  start(job: JobStart): Promise<JobSession>;
}

/** Runs each command on the host, in the job's directory: for tests that need a real shell. */
export class ProcessExecutor implements JobExecutor {
  readonly #env: Record<string, string>;

  /** `env` is the jobs' machine environment, `PATH` and `HOME` of this process by default. */
  constructor(env: Record<string, string> = {}) {
    this.#env = {
      PATH: process.env.PATH ?? "",
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...env,
    };
  }

  async start(job: JobStart): Promise<JobSession> {
    const base = this.#env;
    return {
      root: job.hostRoot,
      exec: (command) => {
        const [file = "", ...args] =
          command.kind === "run" ? command.argv : [process.execPath, command.entry];
        const env = {
          ...base,
          ...command.env,
          PATH: [...command.path, base.PATH ?? ""].filter(Boolean).join(delimiter),
        };
        return new Promise((resolve) => {
          const chunks: Buffer[] = [];
          let timedOut = false;
          const child = spawn(file, args, {
            cwd: command.cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"],
          });
          const kill = () => child.kill("SIGKILL");
          const timer = setTimeout(() => {
            timedOut = true;
            kill();
          }, command.timeoutMs);
          command.signal.addEventListener("abort", kill, { once: true });
          child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
          child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
          const done = (exitCode: number, extra = "") => {
            clearTimeout(timer);
            command.signal.removeEventListener("abort", kill);
            resolve({
              exitCode,
              output: Buffer.concat(chunks).toString("utf8") + extra,
              ...(timedOut ? { timedOut } : {}),
            });
          };
          child.on("error", (error) => done(127, `${error.message}\n`));
          child.on("close", (code) => done(code ?? 1));
        });
      },
      stop: async () => undefined,
    };
  }
}

/** A command the recording executor received, with the job it ran in. */
export interface Recorded {
  runId: number;
  job: string;
  step: StepInfo;
  kind: Command["kind"];
  /** The script of a `run:` step, or the `step` input of Codeman's action. */
  script?: string;
  inputs?: Record<string, string>;
  env: Record<string, string>;
  cwd: string;
}

/** Answers a command in process: writes outputs with `writeOutputs`, returns its exit code. */
export type Handler = (
  command: Command,
  job: JobStart,
) => CommandResult | undefined | Promise<CommandResult | undefined>;

/**
 * Runs nothing: records each command, and lets `handler` answer it, exit code 0 with no output by
 * default. The job sees the host's directory as it is, so a handler writes files where the
 * command's environment says.
 */
export class RecordingExecutor implements JobExecutor {
  readonly commands: Recorded[] = [];
  readonly #handler: Handler | undefined;

  constructor(handler?: Handler) {
    this.#handler = handler;
  }

  async start(job: JobStart): Promise<JobSession> {
    return {
      root: job.hostRoot,
      exec: async (command) => {
        this.commands.push({
          runId: job.runId,
          job: job.name,
          step: command.step,
          kind: command.kind,
          ...(command.kind === "run" ? { script: command.script } : { inputs: command.inputs }),
          env: command.env,
          cwd: command.cwd,
        });
        return (await this.#handler?.(command, job)) ?? { exitCode: 0, output: "" };
      },
      stop: async () => undefined,
    };
  }

  /** The commands of the jobs whose name is or starts with `name`. */
  of(name: string): Recorded[] {
    return this.commands.filter(
      (command) => command.job === name || command.job.startsWith(`${name} `),
    );
  }
}
