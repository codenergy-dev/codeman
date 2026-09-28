import type { CommandProblem } from "./problems.ts";
import {
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
  let fenced = false;
  let open: OpenText | undefined;
  const close = () => {
    if (open) commands.push(finishText(open));
    open = undefined;
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const fence = /^(```|~~~)/.test(line);
    if (!fenced && !fence && line.split(/\s+/)[0]?.toLowerCase() === "/codeman") {
      close();
      const parsed = parseLine(line);
      if ("lines" in parsed) open = parsed;
      else commands.push(parsed);
      continue;
    }
    if (fence) fenced = !fenced;
    open?.lines.push(raw);
  }
  close();
  return commands;
}

function parseLine(line: string): Command | OpenText {
  const [, name, ...args] = line.split(/\s+/);
  const invalid = (problem: CommandProblem): Command => ({ kind: "invalid", text: line, problem });
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

/** `set <name> <value>`, for the settings a task may override. `model <id>` is a shortcut. */
function parseSet(args: string[], invalid: (problem: CommandProblem) => Command): Command {
  const [name = "", value, ...rest] = args;
  if (!isSettingName(name) || !TASK_SETTINGS.has(name)) {
    return invalid({ kind: "set-which", names: [...TASK_SETTINGS] });
  }
  if (value === undefined || rest.length > 0) return invalid({ kind: "set-one-value", name });
  const parsed = parseSetting(name, value);
  return parsed.ok
    ? { kind: "set", name, value: parsed.value }
    : invalid({ kind: "invalid-setting", name, type: settingKind(name) });
}

function finishText(open: OpenText): Command {
  const text = open.lines.join("\n").trim();
  const invalid = (problem: CommandProblem): Command => ({
    kind: "invalid",
    text: open.line,
    problem,
  });
  if (text.length > MAX_TEXT) return invalid({ kind: "text-too-long", max: MAX_TEXT });
  if (open.kind !== "answer") return { kind: open.kind, text };
  if (text === "") return invalid({ kind: "answer-needs-text" });
  return { kind: "answer", id: open.id ?? 0, text };
}
