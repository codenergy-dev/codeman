/**
 * What the fake reads of a workflow file, without a YAML parser: its `name`, whether it has a
 * `workflow_dispatch` trigger, and that trigger's input names. Enough for block-style files such
 * as Codeman's templates, and the inline forms `on: workflow_dispatch` and `on: [a, b]`.
 */

export interface WorkflowInfo {
  name: string | undefined;
  dispatch: boolean;
  inputs: string[];
}

interface Line {
  indent: number;
  text: string;
}

export function workflowInfo(source: string): WorkflowInfo {
  const lines: Line[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const text = raw.replace(/(^|\s)#.*$/, "").trimEnd();
    if (text.trim() === "") continue;
    lines.push({ indent: text.length - text.trimStart().length, text: text.trim() });
  }
  const info: WorkflowInfo = { name: undefined, dispatch: false, inputs: [] };
  for (const [index, line] of lines.entries()) {
    if (line.indent !== 0) continue;
    const [key, value] = keyValue(line.text);
    if (key === "name" && value) info.name = unquote(value);
    if (key !== "on" && key !== "true") continue;
    if (value) {
      const triggers = value.startsWith("[")
        ? value
            .slice(1, -1)
            .split(",")
            .map((item) => unquote(item.trim()))
        : [unquote(value)];
      info.dispatch ||= triggers.includes("workflow_dispatch");
      continue;
    }
    const block = children(lines, index);
    const dispatch = block.find((child) => {
      const [name] = keyValue(child.line.text.replace(/^-\s*/, ""));
      return name === "workflow_dispatch";
    });
    if (!dispatch) continue;
    info.dispatch = true;
    const inputs = children(lines, dispatch.index).find(
      (child) => keyValue(child.line.text)[0] === "inputs",
    );
    if (!inputs) continue;
    info.inputs = children(lines, inputs.index)
      .map((child) => keyValue(child.line.text)[0])
      .filter((name): name is string => name !== undefined);
  }
  return info;
}

/** The lines one level under `lines[parent]`, with their indexes. */
function children(lines: readonly Line[], parent: number): { line: Line; index: number }[] {
  const base = lines[parent]?.indent ?? 0;
  const found: { line: Line; index: number }[] = [];
  let level: number | undefined;
  for (let index = parent + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line || line.indent <= base) break;
    level ??= line.indent;
    if (line.indent === level) found.push({ line, index });
  }
  return found;
}

function keyValue(text: string): [string | undefined, string] {
  const match = /^("[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(?:\s+(.*))?$/.exec(text);
  if (!match) return [undefined, ""];
  return [unquote(match[1] ?? ""), (match[2] ?? "").trim()];
}

function unquote(text: string): string {
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
}
