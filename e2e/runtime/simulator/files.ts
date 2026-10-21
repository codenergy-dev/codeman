import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a step tells the runner, as GitHub's runner reads it: the files `GITHUB_OUTPUT`,
 * `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_STATE` and `GITHUB_STEP_SUMMARY`, new for each step, and
 * the workflow commands a step prints (`::add-mask::`, `::set-output::`, `::stop-commands::`…).
 * `::set-env::` and `::add-path::` are refused, as GitHub refuses them: the step fails and nothing
 * reaches the next step.
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

/** `NAME=value` lines and `NAME<<DELIMITER` blocks, as `GITHUB_OUTPUT`, `_ENV` and `_STATE` hold them. */
export function parseKeyValues(text: string, file: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";
    if (line === "") continue;
    const equals = line.indexOf("=");
    const heredoc = line.indexOf("<<");
    if (equals >= 0 && (heredoc < 0 || equals < heredoc)) {
      const name = line.slice(0, equals);
      if (name === "") throw new FileCommandError(`Invalid format '${line}' in ${file}`);
      values.set(name, line.slice(equals + 1));
      continue;
    }
    if (heredoc >= 0) {
      const name = line.slice(0, heredoc);
      const delimiter = line.slice(heredoc + 2);
      if (name === "" || delimiter === "") {
        throw new FileCommandError(`Invalid format '${line}' in ${file}`);
      }
      const body: string[] = [];
      for (;;) {
        at++;
        if (at >= lines.length) {
          throw new FileCommandError(`Matching delimiter not found '${delimiter}' in ${file}`);
        }
        if (lines[at] === delimiter) break;
        body.push(lines[at] ?? "");
      }
      values.set(name, body.join("\n"));
      continue;
    }
    throw new FileCommandError(`Invalid format '${line}' in ${file}`);
  }
  return values;
}

/** `GITHUB_PATH`'s directories, one per line. */
export function parsePaths(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line !== "");
}

/** What a step left in its command files. */
export interface FileResults {
  outputs: Map<string, string>;
  env: Map<string, string>;
  paths: string[];
  state: Map<string, string>;
  summary: string;
}

/** Reads a step's command files; throws a `FileCommandError` on a malformed one. */
export function readStepFiles(host: Record<FileCommand, string>): FileResults {
  const read = (kind: FileCommand) => readFileSync(host[kind], "utf8");
  const env = parseKeyValues(read("env"), FILE_COMMANDS.env);
  if (env.has("NODE_OPTIONS")) {
    throw new FileCommandError(
      "Can't store NODE_OPTIONS output parameter using '$GITHUB_ENV' command.",
    );
  }
  return {
    outputs: parseKeyValues(read("output"), FILE_COMMANDS.output),
    env,
    paths: parsePaths(read("path")),
    state: parseKeyValues(read("state"), FILE_COMMANDS.state),
    summary: read("summary"),
  };
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
  /** `error` and refused commands, as the log shows them. */
  errors: string[];
  warnings: string[];
  /** Commands GitHub refuses, which fail the step. */
  refused: string[];
}

function unescapeData(text: string): string {
  return text.replace(/%0D/gi, "\r").replace(/%0A/gi, "\n").replace(/%25/g, "%");
}

function unescapeProperty(text: string): string {
  return unescapeData(text).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}

/** The workflow commands in a step's output, line by line, honoring `::stop-commands::`. */
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
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    const match = /^::([A-Za-z0-9_-]+)(?: ([^:]*))?::(.*)$/s.exec(line);
    if (!match) continue;
    const [, command = "", rawProperties = "", rawData = ""] = match;
    if (stopped !== undefined) {
      if (command === stopped) stopped = undefined;
      continue;
    }
    const properties = new Map<string, string>();
    for (const pair of rawProperties.split(",")) {
      const equals = pair.indexOf("=");
      if (equals > 0) {
        properties.set(pair.slice(0, equals).trim(), unescapeProperty(pair.slice(equals + 1)));
      }
    }
    const data = unescapeData(rawData);
    switch (command) {
      case "set-env":
      case "add-path":
        found.refused.push(command);
        found.errors.push(
          `Unable to process command '${line}' successfully. The \`${command}\` command is disabled. Please upgrade to using Environment Files or opt into unsecure command execution by setting the \`ACTIONS_ALLOW_UNSECURE_COMMANDS\` environment variable to \`true\`.`,
        );
        break;
      case "set-output":
        if (properties.get("name")) found.outputs.set(properties.get("name") ?? "", data);
        found.warnings.push("The `set-output` command is deprecated.");
        break;
      case "save-state":
        if (properties.get("name")) found.state.set(properties.get("name") ?? "", data);
        break;
      case "add-mask":
        if (data !== "") found.masks.push(data);
        break;
      case "stop-commands":
        if (data !== "") stopped = data;
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
