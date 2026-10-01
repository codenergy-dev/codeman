/** A command to run inside the sandbox. Secrets go in `env`, never in `args`, which any user can list. */
export interface HarnessCommand {
  file: string;
  args: string[];
  env: Record<string, string>;
}

export interface HarnessOptions {
  /** Path to the executable returned by `install`. */
  executable: string;
  /** OpenRouter model ID, such as `deepseek/deepseek-v4.1-flash`. */
  model: string;
  apiKey: string;
  /** Short instruction for the agent; the full task is in a file it is pointed to. */
  prompt: string;
  /** Absolute path of Codeman's working rules, to load next to the repository's `AGENTS.md`. */
  instructions?: string | undefined;
  /** Sends `prompt` to the session that ran last, instead of starting a new one. */
  resume?: boolean | undefined;
}

/** A third-party coding agent that Codeman drives. Codeman owns the sandbox, the task and the output. */
export interface Harness {
  readonly name: string;
  /** Downloads and verifies the harness into `dir`, and returns the path to its executable. */
  install(dir: string): Promise<string>;
  /** Builds the command that runs one task in the current directory. */
  command(options: HarnessOptions): HarnessCommand;
}
