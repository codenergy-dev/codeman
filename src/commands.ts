export type Command =
  | { kind: "approve" }
  | { kind: "decide"; answers: ReadonlyMap<number, string> }
  | { kind: "model"; model: string }
  | { kind: "invalid"; text: string; reason: string };

/** OpenRouter model IDs, such as `deepseek/deepseek-v4.1-flash` or `~deepseek/deepseek-flash-latest`. */
const MODEL_ID = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
const ANSWER = /^(\d{1,2})=([a-z])$/i;

export function isModelId(text: string): boolean {
  return text.length <= 100 && MODEL_ID.test(text);
}

/**
 * Reads `/codeman` commands from a comment. Each command is a line that starts with
 * `/codeman`; lines inside fenced code blocks are ignored.
 */
export function parseCommands(body: string): Command[] {
  const commands: Command[] = [];
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const [prefix, name, ...args] = line.split(/\s+/);
    if (prefix?.toLowerCase() !== "/codeman") continue;
    commands.push(parseCommand(line, name?.toLowerCase(), args));
  }
  return commands;
}

function parseCommand(text: string, name: string | undefined, args: string[]): Command {
  const invalid = (reason: string): Command => ({ kind: "invalid", text, reason });
  switch (name) {
    case "approve":
      return args.length === 0 ? { kind: "approve" } : invalid("`approve` takes no arguments.");
    case "decide": {
      if (args.length === 0) return invalid("`decide` needs answers such as `1=a 2=b`.");
      const answers = new Map<number, string>();
      for (const arg of args) {
        const match = ANSWER.exec(arg);
        if (!match?.[1] || !match[2])
          return invalid(`\`${arg}\` is not an answer such as \`1=a\`.`);
        answers.set(Number(match[1]), match[2].toLowerCase());
      }
      return { kind: "decide", answers };
    }
    case "model": {
      const [model, ...rest] = args;
      if (!model || rest.length > 0 || !isModelId(model)) {
        return invalid("`model` needs one OpenRouter model ID, such as `provider/model`.");
      }
      return { kind: "model", model };
    }
    default:
      return invalid("Unknown command. Use `approve`, `decide` or `model`.");
  }
}
