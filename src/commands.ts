export type Command =
  | { kind: "approve" }
  | { kind: "decide"; answers: ReadonlyMap<number, string> }
  | { kind: "answer"; id: number; text: string }
  | { kind: "replan"; text: string }
  | { kind: "model"; model: string }
  | { kind: "invalid"; text: string; reason: string };

/** OpenRouter model IDs, such as `deepseek/deepseek-v4.1-flash` or `~deepseek/deepseek-flash-latest`. */
const MODEL_ID = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
const DECISION_ID = /^\d{1,2}$/;
const OPTION_KEY = /^[a-z]$/i;
const ASSIGNMENT = /^(\d{1,2})=([a-z])$/i;
const ANSWER = /^\/codeman\s+answer(?:\s+(\S+))?\s*(.*)$/i;
const REPLAN = /^\/codeman\s+replan\b\s*(.*)$/i;
export const MAX_TEXT = 2000;

export function isModelId(text: string): boolean {
  return text.length <= 100 && MODEL_ID.test(text);
}

/** A command that takes free text: its first line, plus the lines that follow it. */
interface OpenText {
  line: string;
  kind: "answer" | "replan";
  id?: number;
  lines: string[];
}

/**
 * Reads `/codeman` commands from a comment. A command is a line that starts with `/codeman`
 * outside a fenced code block. `answer` and `replan` take free text: the rest of their line
 * and every following line up to the next command.
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
      return { line, kind: "replan", lines: [REPLAN.exec(line)?.[1] ?? ""] };
    case "model": {
      const [model, ...rest] = args;
      if (!model || rest.length > 0 || !isModelId(model)) {
        return invalid("`model` needs one OpenRouter model ID, such as `provider/model`.");
      }
      return { kind: "model", model };
    }
    default:
      return invalid("Unknown command. Use `decide`, `approve`, `answer`, `replan` or `model`.");
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

function finishText(open: OpenText): Command {
  const text = open.lines.join("\n").trim();
  const invalid = (reason: string): Command => ({ kind: "invalid", text: open.line, reason });
  if (text.length > MAX_TEXT) return invalid(`The text must have at most ${MAX_TEXT} characters.`);
  if (open.kind === "replan") return { kind: "replan", text };
  if (text === "") return invalid("`answer` needs text after the decision number.");
  return { kind: "answer", id: open.id ?? 0, text };
}
