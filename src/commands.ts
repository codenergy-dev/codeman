import { isSettingName, parseSetting, type SettingName, TASK_SETTINGS } from "./settings.ts";

export type Command =
  | { kind: "approve" }
  | { kind: "decide"; answers: ReadonlyMap<number, string> }
  | { kind: "answer"; id: number; text: string }
  | { kind: "replan"; text: string }
  | { kind: "fix"; text: string }
  | { kind: "continue"; text: string }
  | { kind: "set"; name: SettingName; value: string | number }
  | { kind: "invalid"; text: string; reason: string };

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
  const invalid = (reason: string): Command => ({ kind: "invalid", text: line, reason });
  switch (name?.toLowerCase()) {
    case "approve":
      return args.length === 0 ? { kind: "approve" } : invalid("`approve` takes no arguments.");
    case "decide":
      return parseDecide(args, invalid);
    case "answer": {
      const [, id = "", first = ""] = ANSWER.exec(line) ?? [];
      if (!DECISION_ID.test(id))
        return invalid("`answer` needs a decision number, such as `answer 2 <text>`.");
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
      return invalid(
        "Unknown command. Use `decide`, `approve`, `answer`, `replan`, `fix`, `continue`, `set` or `model`.",
      );
  }
}

/** Accepts `1=a`, `1 a`, and several of either in one command: `1=a 2 b`. */
function parseDecide(args: string[], invalid: (reason: string) => Command): Command {
  if (args.length === 0) return invalid("`decide` needs answers such as `1 a` or `1=a`.");
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
      return invalid(`\`${arg}\` is not an answer such as \`1 a\` or \`1=a\`.`);
    }
  }
  return { kind: "decide", answers };
}

/** `set <name> <value>`, for the settings a task may override. `model <id>` is a shortcut. */
function parseSet(args: string[], invalid: (reason: string) => Command): Command {
  const [name = "", value, ...rest] = args;
  const names = [...TASK_SETTINGS].map((setting) => `\`${setting}\``).join(", ");
  if (!isSettingName(name) || !TASK_SETTINGS.has(name)) {
    return invalid(`\`set\` changes one of ${names} for this task.`);
  }
  if (value === undefined || rest.length > 0) return invalid(`\`set ${name}\` needs one value.`);
  const parsed = parseSetting(name, value);
  return parsed.ok ? { kind: "set", name, value: parsed.value } : invalid(parsed.error);
}

function finishText(open: OpenText): Command {
  const text = open.lines.join("\n").trim();
  const invalid = (reason: string): Command => ({ kind: "invalid", text: open.line, reason });
  if (text.length > MAX_TEXT) return invalid(`The text must have at most ${MAX_TEXT} characters.`);
  if (open.kind !== "answer") return { kind: open.kind, text };
  if (text === "") return invalid("`answer` needs text after the decision number.");
  return { kind: "answer", id: open.id ?? 0, text };
}
