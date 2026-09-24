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
}

/** A third-party coding agent that Codeman drives. Codeman owns the sandbox, the task and the output. */
export interface Harness {
  readonly name: string;
  /** Downloads and verifies the harness into `dir`, and returns the path to its executable. */
  install(dir: string): Promise<string>;
  /** Builds the command that runs one task in the current directory. */
  command(options: HarnessOptions): HarnessCommand;
}
