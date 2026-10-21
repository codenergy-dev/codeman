import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a step tells the runner, as GitHub's runner reads it: the files `GITHUB_OUTPUT`,
 * `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_STATE` and `GITHUB_STEP_SUMMARY`, new for each step
 * (docs/web/github/runner-src-runner-worker-filecommandmanager-cs-at-197ca02.md), and the workflow
 * commands a step prints (docs/web/github/runner-src-runner-worker-actioncommandmanager-cs-at-197ca02.md).
 * A command or file the runner cannot process fails the step; `::set-env::` and `::add-path::`
 * are disabled, so they always do, and nothing of theirs reaches the next step.
 */

export const FILE_COMMANDS = {
  output: "GITHUB_OUTPUT",
  env: "GITHUB_ENV",
  path: "GITHUB_PATH",
  state: "GITHUB_STATE",
  summary: "GITHUB_STEP_SUMMARY",
} as const;
export type FileCommand = keyof typeof FILE_COMMANDS;

/** A malformed file command, which fails its step. */
export class FileCommandError extends Error {}

/** A step's new, empty command files, as the job sees them and as the host reads them. */
export function stepFiles(
  hostDir: string,
  viewDir: string,
): { host: Record<FileCommand, string>; view: Record<FileCommand, string> } {
  const host = {} as Record<FileCommand, string>;
  const view = {} as Record<FileCommand, string>;
  const names: Record<FileCommand, string> = {
    output: "set_output",
    env: "set_env",
    path: "add_path",
    state: "save_state",
    summary: "step_summary",
  };
  for (const [kind, name] of Object.entries(names) as [FileCommand, string][]) {
    const file = `${name}_${randomUUID()}`;
    host[kind] = join(hostDir, file);
    view[kind] = `${viewDir}/${file}`;
    writeFileSync(host[kind], "");
  }
  return { host, view };
}

/**
 * The pairs of `NAME=value` lines and `NAME<<DELIMITER` blocks, as `EnvFileKeyValuePairs` reads
 * `GITHUB_OUTPUT`, `_ENV` and `_STATE`; throws a `FileCommandError` at the first malformed line,
 * after yielding the pairs before it. As in the runner, `=value` yields an empty name.
 */
export function* keyValues(text: string): Generator<[string, string]> {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";
    if (line === "") continue;
    const equals = line.indexOf("=");
    const heredoc = line.indexOf("<<");
    if (equals >= 0 && (heredoc < 0 || equals < heredoc)) {
      yield [line.slice(0, equals), line.slice(equals + 1)];
      continue;
    }
    if (heredoc >= 0) {
      const name = line.slice(0, heredoc);
      const delimiter = line.slice(heredoc + 2);
      if (name === "" || delimiter === "") {
        throw new FileCommandError(
          `Invalid format '${line}'. Name must not be empty and delimiter must not be empty`,
        );
      }
      const body: string[] = [];
      for (;;) {
        at++;
        if (at >= lines.length) {
          throw new FileCommandError(`Invalid value. Matching delimiter not found '${delimiter}'`);
        }
        if (lines[at] === delimiter) break;
        body.push(lines[at] ?? "");
      }
      yield [name, body.join("\n")];
      continue;
    }
    throw new FileCommandError(`Invalid format '${line}'`);
  }
}

/** A key-value file's pairs; throws a `FileCommandError` on a malformed one. */
export function parseKeyValues(text: string): Map<string, string> {
  return new Map(keyValues(text));
}

/** `GITHUB_PATH`'s directories, one per line, as written. */
export function parsePaths(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "");
}

/** What a step left in its command files, and the errors that fail it. */
export interface FileResults {
  outputs: Map<string, string>;
  env: Map<string, string>;
  paths: string[];
  state: Map<string, string>;
  summary: string;
  /** Errors for the log; `failed` when one of them fails the step. */
  errors: string[];
  failed: boolean;
}

/** `GITHUB_ENV` may not set these, ignoring case: the pair is left out, and the step goes on. */
const ENV_BLOCKED = ["NODE_OPTIONS"];

/**
 * Reads a step's command files as `FileCommandManager.ProcessFiles` does: each file on its own,
 * and a malformed one keeps the pairs before its error and fails the step.
 */
export function readStepFiles(host: Record<FileCommand, string>): FileResults {
  const found: FileResults = {
    outputs: new Map(),
    env: new Map(),
    paths: [],
    state: new Map(),
    summary: readFileSync(host.summary, "utf8"),
    errors: [],
    failed: false,
  };
  const pairs = (kind: "output" | "env" | "state", into: Map<string, string>) => {
    try {
      for (const [name, value] of keyValues(readFileSync(host[kind], "utf8"))) {
        if (
          kind === "env" &&
          ENV_BLOCKED.some((blocked) => blocked.toLowerCase() === name.toLowerCase())
        ) {
          found.errors.push(
            `Can't store ${name.toUpperCase()} output parameter using '$GITHUB_ENV' command.`,
          );
          continue;
        }
        into.set(name, value);
      }
    } catch (error) {
      if (!(error instanceof FileCommandError)) throw error;
      found.errors.push(`Unable to process file command '${kind}' successfully.`, error.message);
      found.failed = true;
    }
  };
  pairs("output", found.outputs);
  pairs("env", found.env);
  pairs("state", found.state);
  found.paths = parsePaths(readFileSync(host.path, "utf8"));
  return found;
}

/**
 * Writes outputs to the file `GITHUB_OUTPUT` names in `env`, as `@actions/core`'s `setOutput`
 * does: for an executor that stands in for a step.
 */
export function writeOutputs(env: Record<string, string>, values: Record<string, string>): void {
  const file = env[FILE_COMMANDS.output];
  if (!file) throw new Error("No GITHUB_OUTPUT in the step's environment.");
  for (const [name, value] of Object.entries(values)) {
    const delimiter = `ghadelimiter_${randomUUID()}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

/** What a step's printed workflow commands did. */
export interface PrintedCommands {
  outputs: Map<string, string>;
  state: Map<string, string>;
  masks: string[];
  /** Errors for the log: `::error::` and commands the runner could not process. */
  errors: string[];
  warnings: string[];
  /** Commands the runner could not process, such as the disabled `set-env`: each fails the step. */
  refused: string[];
}

/** The runner's registered commands; only these parse as `::<name>...::` commands. */
const COMMANDS = new Set([
  "set-env",
  "set-output",
  "save-state",
  "add-mask",
  "add-path",
  "add-matcher",
  "remove-matcher",
  "warning",
  "error",
  "notice",
  "debug",
  "group",
  "endgroup",
  "echo",
  "internal-set-repo-path",
  "stop-commands",
]);

/** `ActionCommand.UnescapeData`'s replacements, in its order and case. */
function unescapeData(text: string): string {
  return text.replaceAll("%0D", "\r").replaceAll("%0A", "\n").replaceAll("%25", "%");
}

/** `ActionCommand.UnescapeProperty`'s replacements, in its order and case. */
function unescapeProperty(text: string): string {
  return text
    .replaceAll("%0D", "\r")
    .replaceAll("%0A", "\n")
    .replaceAll("%3A", ":")
    .replaceAll("%2C", ",")
    .replaceAll("%25", "%");
}

/**
 * The workflow commands in a step's output, line by line, as `ActionCommand.TryParseV2` parses
 * them and `ActionCommandManager.TryProcessCommand` runs them.
 */
export function readCommands(output: string): PrintedCommands {
  const found: PrintedCommands = {
    outputs: new Map(),
    state: new Map(),
    masks: [],
    errors: [],
    warnings: [],
    refused: [],
  };
  let stopped: string | undefined;
  const refuse = (command: string, line: string, message: string) => {
    found.refused.push(command);
    found.errors.push(`Unable to process command '${line}' successfully.`, message);
  };
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "").trimStart();
    if (!line.startsWith("::")) continue;
    const end = line.indexOf("::", 2);
    if (end < 0) continue;
    const info = line.slice(2, end);
    const space = info.indexOf(" ");
    const command = (space < 0 ? info : info.slice(0, space)).toLowerCase();
    if (stopped !== undefined) {
      if (command === stopped.toLowerCase()) stopped = undefined;
      continue;
    }
    if (!COMMANDS.has(command)) continue;
    const properties = new Map<string, string>();
    if (space > 0) {
      for (const pair of info
        .slice(space + 1)
        .trim()
        .split(",")
        .filter(Boolean)) {
        const equals = pair.indexOf("=");
        if (equals > 0 && equals < pair.length - 1) {
          properties.set(pair.slice(0, equals), unescapeProperty(pair.slice(equals + 1)));
        }
      }
    }
    const data = unescapeData(line.slice(end + 2));
    switch (command) {
      case "set-env":
      case "add-path":
        refuse(
          command,
          line,
          `The \`${command}\` command is disabled. Please upgrade to using Environment Files or opt into unsecure command execution by setting the \`ACTIONS_ALLOW_UNSECURE_COMMANDS\` environment variable to \`true\`.`,
        );
        break;
      case "set-output":
      case "save-state": {
        const name = properties.get("name");
        if (!name) {
          refuse(command, line, `Required field 'name' is missing in ##[${command}] command.`);
          break;
        }
        (command === "set-output" ? found.outputs : found.state).set(name, data);
        break;
      }
      case "add-mask":
        if (data.trim() === "") {
          found.warnings.push("Can't add secret mask for empty string in ##[add-mask] command.");
          break;
        }
        for (const mask of new Set([data, ...data.split(/[\r\n]+/).map((part) => part.trim())])) {
          if (mask !== "") found.masks.push(mask);
        }
        break;
      case "stop-commands":
        if (
          data === "" ||
          data.toLowerCase() === "pause-logging" ||
          COMMANDS.has(data.toLowerCase())
        ) {
          refuse(
            command,
            line,
            "You cannot use a endToken that is an empty string, the string 'pause-logging', or another workflow command.",
          );
          break;
        }
        stopped = data;
        break;
      case "error":
        found.errors.push(data);
        break;
      case "warning":
        found.warnings.push(data);
        break;
      default:
        break;
    }
  }
  return found;
}
