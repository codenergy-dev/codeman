import type { CommandProblem } from "./problems.ts";
import {
  CHOICES,
  isSettingName,
  parseSetting,
  type SettingName,
  settingKind,
  TASK_SETTINGS,
} from "./settings.ts";

export type Command =
  | { kind: "approve" }
  | { kind: "accept-workflows" }
  | { kind: "decide"; answers: ReadonlyMap<number, string> }
  | { kind: "answer"; id: number; text: string }
  | { kind: "replan"; text: string }
  | { kind: "fix"; text: string }
  | { kind: "continue"; text: string }
  | { kind: "set"; name: SettingName; value: string | number }
  | { kind: "invalid"; text: string; problem: CommandProblem };

const DECISION_ID = /^\d{1,2}$/;
const OPTION_KEY = /^[a-z]$/i;
const ASSIGNMENT = /^(\d{1,2})=([a-z])$/i;
const ANSWER = /^\/codeman\s+answer(?:\s+(\S+))?\s*(.*)$/i;
const OPEN_TEXT = /^\/codeman\s+\S+\s*(.*)$/i;
export const MAX_TEXT = 2000;

/** A command that takes free text: its first line, plus the lines that follow it. */
interface OpenText {
  line: string;
  kind: "answer" | "replan" | "fix" | "continue";
  id?: number;
  lines: string[];
}

/**
 * Reads `/codeman` commands from a comment. A command is a line that starts with `/codeman`
 * outside a fenced code block. `answer`, `replan`, `fix` and `continue` take free text: the
 * rest of their line and every following line up to the next command.
 */
export function parseCommands(body: string): Command[] {
  const commands: Command[] = [];
  let open: OpenText | undefined;
  const close = () => {
    if (open) commands.push(finishText(open));
    open = undefined;
  };

  for (const { raw, command } of scan(body)) {
    if (command) {
      close();
      const parsed = parseLine(raw.trim());
      if ("lines" in parsed) open = parsed;
      else commands.push(parsed);
      continue;
    }
    open?.lines.push(raw);
  }
  close();
  return commands;
}

/**
 * Reads the commands in an issue's description, where only `set` and `model` count, and the
 * description without its command lines, for the agent. Other commands are problems.
 */
export function descriptionCommands(body: string): { commands: Command[]; text: string } {
  const lines = scan(body);
  const commands = lines.flatMap(({ raw, command }): Command[] => {
    if (!command) return [];
    const line = raw.trim();
    const [, name = "", ...args] = line.split(/\s+/);
    switch (name.toLowerCase()) {
      case "model":
        return [parseSet(["model", ...args], invalidLine(line))];
      case "set":
        return [parseSet(args, invalidLine(line))];
      default:
        return [invalidLine(line)({ kind: "not-in-description" })];
    }
  });
  const text = lines
    .filter(({ command }) => !command)
    .map(({ raw }) => raw)
    .join("\n")
    .trim();
  return { commands, text };
}

/** Each line of a text, and whether it is a command: it starts with `/codeman`, outside a fence. */
function scan(body: string): { raw: string; command: boolean }[] {
  let fenced = false;
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    const fence = /^(```|~~~)/.test(line);
    if (fence) fenced = !fenced;
    const command = !fenced && !fence && line.split(/\s+/)[0]?.toLowerCase() === "/codeman";
    return { raw, command };
  });
}

function invalidLine(line: string): (problem: CommandProblem) => Command {
  return (problem) => ({ kind: "invalid", text: line, problem });
}

function parseLine(line: string): Command | OpenText {
  const [, name, ...args] = line.split(/\s+/);
  const invalid = invalidLine(line);
  switch (name?.toLowerCase()) {
    case "approve":
      return args.length === 0
        ? { kind: "approve" }
        : invalid({ kind: "takes-no-arguments", command: "approve" });
    case "decide":
      return parseDecide(args, invalid);
    case "accept-workflows":
      return args.length === 0
        ? { kind: "accept-workflows" }
        : invalid({ kind: "takes-no-arguments", command: "accept-workflows" });
    case "answer": {
      const [, id = "", first = ""] = ANSWER.exec(line) ?? [];
      if (!DECISION_ID.test(id)) return invalid({ kind: "answer-needs-number" });
      return { line, kind: "answer", id: Number(id), lines: [first] };
    }
    case "replan":
    case "fix":
    case "continue":
      return {
        line,
        kind: name.toLowerCase() as OpenText["kind"],
        lines: [OPEN_TEXT.exec(line)?.[1] ?? ""],
      };
    case "model":
      return parseSet(["model", ...args], invalid);
    case "set":
      return parseSet(args, invalid);
    default:
      return invalid({ kind: "unknown-command" });
  }
}

/** Accepts `1=a`, `1 a`, and several of either in one command: `1=a 2 b`. */
function parseDecide(args: string[], invalid: (problem: CommandProblem) => Command): Command {
  if (args.length === 0) return invalid({ kind: "decide-needs-answers" });
  const answers = new Map<number, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const next = args[index + 1] ?? "";
    const assignment = ASSIGNMENT.exec(arg);
    if (assignment?.[1] && assignment[2]) {
      answers.set(Number(assignment[1]), assignment[2].toLowerCase());
    } else if (DECISION_ID.test(arg) && OPTION_KEY.test(next)) {
      answers.set(Number(arg), next.toLowerCase());
      index++;
    } else {
      return invalid({ kind: "not-an-answer", arg });
    }
  }
  return { kind: "decide", answers };
}

/**
 * `set <name> <value>`, for the settings a task may override. `model <id>` is a shortcut. A GPU
 * type's name has spaces, so `gpu-type` takes the rest of the line.
 */
function parseSet(args: string[], invalid: (problem: CommandProblem) => Command): Command {
  const [name = "", ...values] = args;
  if (!isSettingName(name) || !TASK_SETTINGS.has(name)) {
    return invalid({ kind: "set-which", names: [...TASK_SETTINGS] });
  }
  const value = name === "gpu-type" && values.length > 0 ? values.join(" ") : values[0];
  if (value === undefined || (name !== "gpu-type" && values.length > 1)) {
    return invalid({ kind: "set-one-value", name });
  }
  const parsed = parseSetting(name, value);
  return parsed.ok
    ? { kind: "set", name, value: parsed.value }
    : invalid({
        kind: "invalid-setting",
        name,
        type: settingKind(name),
        ...(CHOICES[name] ? { values: CHOICES[name] } : {}),
      });
}

function finishText(open: OpenText): Command {
  const text = open.lines.join("\n").trim();
  const invalid = invalidLine(open.line);
  if (text.length > MAX_TEXT) return invalid({ kind: "text-too-long", max: MAX_TEXT });
  if (open.kind !== "answer") return { kind: open.kind, text };
  if (text === "") return invalid({ kind: "answer-needs-text" });
  return { kind: "answer", id: open.id ?? 0, text };
}
