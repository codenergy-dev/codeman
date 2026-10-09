/**
 * The subset of YAML that Codeman's settings use, read without a dependency: block mappings,
 * block lists, and lists of scalars in brackets, with plain or quoted scalars and `#` comments.
 * Anything else is an error that names its line, so a text never means something other than
 * what it looks like, and whatever it accepts means the same in YAML.
 */

/** A value, with the line it starts on (1-based). Scalars are kept as text. */
export type YamlNode =
  | { kind: "scalar"; line: number; text: string }
  | { kind: "list"; line: number; items: YamlNode[] }
  | { kind: "map"; line: number; entries: YamlEntry[] };

export interface YamlEntry {
  key: string;
  line: number;
  value: YamlNode;
}

export type YamlMap = Extract<YamlNode, { kind: "map" }>;

export type ParsedYaml = { ok: true; value: YamlMap } | { ok: false; line: number; error: string };

interface Line {
  number: number;
  indent: number;
  /** The line without its indentation. */
  text: string;
}

class YamlError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.line = line;
  }
}

/** A key: letters, digits, `-` and `_`, so a key written as an environment variable reads. */
const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/;
/** A list item: a dash, then a space or the end of the line. */
const ITEM = /^-(?:\s|$)/;

/** Parses a text whose top level is a mapping; an empty text is an empty one. */
export function parseYaml(text: string): ParsedYaml {
  const lines: Line[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    const content = line.trimStart();
    if (content === "" || content.startsWith("#")) continue;
    const indentation = line.slice(0, line.length - content.length);
    if (indentation.includes("\t")) {
      return { ok: false, line: index + 1, error: "indent with spaces, not tabs." };
    }
    lines.push({ number: index + 1, indent: indentation.length, text: content });
  }
  try {
    const reader = new Reader(lines);
    const value = reader.mapping(0);
    const rest = reader.peek();
    if (rest) throw new YamlError(rest.number, "unexpected indentation.");
    return { ok: true, value };
  } catch (error) {
    if (error instanceof YamlError) return { ok: false, line: error.line, error: error.message };
    throw error;
  }
}

class Reader {
  readonly #lines: Line[];
  #next = 0;

  constructor(lines: Line[]) {
    this.#lines = lines;
  }

  peek(): Line | undefined {
    return this.#lines[this.#next];
  }

  /** The `key: value` lines at `indent`, and what is nested under them. */
  mapping(indent: number): YamlMap {
    const map: YamlMap = { kind: "map", line: this.peek()?.number ?? 1, entries: [] };
    for (let line = this.peek(); line && line.indent >= indent; line = this.peek()) {
      if (line.indent > indent) throw new YamlError(line.number, "unexpected indentation.");
      const match = KEY.exec(line.text);
      if (!match?.[1] || ITEM.test(line.text)) {
        throw new YamlError(line.number, "expected `name: value`.");
      }
      const key = match[1];
      if (map.entries.some((entry) => entry.key === key)) {
        throw new YamlError(line.number, `\`${key}\` appears twice.`);
      }
      this.#next++;
      map.entries.push({ key, line: line.number, value: this.#value(key, line, match[2] ?? "") });
    }
    return map;
  }

  /** A key's value: on its line, or the block nested under it. */
  #value(key: string, line: Line, text: string): YamlNode {
    if (text === "" || text.startsWith("#")) {
      const child = this.peek();
      if (child && child.indent > line.indent) {
        return ITEM.test(child.text) ? this.#list(child.indent) : this.mapping(child.indent);
      }
      // YAML lets a list sit at its key's indentation.
      if (child && child.indent === line.indent && ITEM.test(child.text)) {
        return this.#list(child.indent);
      }
      return { kind: "scalar", line: line.number, text: "" };
    }
    if (text.startsWith("[")) return flowList(key, line.number, text);
    if (text.startsWith("{")) {
      throw new YamlError(
        line.number,
        `the value of \`${key}\` is in braces, which the settings do not read: write each \`name: value\` on its own line, indented under \`${key}:\`.`,
      );
    }
    const value = scalar(text);
    if (value === undefined) {
      throw new YamlError(line.number, `the value of \`${key}\` is not a plain value.`);
    }
    return { kind: "scalar", line: line.number, text: value };
  }

  /** The `- item` lines at `indent`. An item is a scalar or a mapping that starts on its line. */
  #list(indent: number): YamlNode {
    const list: YamlNode = { kind: "list", line: this.peek()?.number ?? 1, items: [] };
    for (let line = this.peek(); line && line.indent >= indent; line = this.peek()) {
      if (line.indent > indent) throw new YamlError(line.number, "unexpected indentation.");
      if (!ITEM.test(line.text)) break;
      const after = line.text.slice(1);
      const content = after.trimStart();
      if (content === "" || content.startsWith("#")) {
        throw new YamlError(line.number, "expected a value after `-`, on the same line.");
      }
      if (ITEM.test(content) || content.startsWith("[")) {
        throw new YamlError(line.number, "a list item cannot be a list.");
      }
      if (KEY.test(content)) {
        // The item's first key stands where its text starts; the next ones line up with it.
        line.indent += 1 + after.length - content.length;
        line.text = content;
        list.items.push(this.mapping(line.indent));
        continue;
      }
      this.#next++;
      const value = scalar(content);
      if (value === undefined)
        throw new YamlError(line.number, "a list item is not a plain value.");
      list.items.push({ kind: "scalar", line: line.number, text: value });
    }
    return list;
  }
}

/** `[a, b]`: plain or quoted scalars, then an optional comment. */
function flowList(key: string, line: number, text: string): YamlNode {
  const items: YamlNode[] = [];
  let rest = text.slice(1).trimStart();
  if (rest.startsWith("]")) {
    rest = rest.slice(1);
  } else {
    for (;;) {
      const match = /^(?:"([^"\\]*)"|'([^'\\]*)'|([^,[\]{}"'#]*?))\s*([,\]])\s*/.exec(rest);
      const plain = match?.[3];
      const value = plain === undefined ? (match?.[1] ?? match?.[2]) : plainScalar(plain);
      if (!match || value === undefined || (plain !== undefined && plain === "")) {
        throw new YamlError(line, `an item of \`${key}\` is not a plain value.`);
      }
      items.push({ kind: "scalar", line, text: value });
      rest = rest.slice(match[0].length);
      if (match[4] === "]") break;
    }
  }
  if (!/^\s*(?:#.*)?$/.test(rest)) {
    throw new YamlError(line, `expected only a comment after the list of \`${key}\`.`);
  }
  return { kind: "list", line, items };
}

/** A plain or quoted scalar with an optional trailing comment; undefined for anything else. */
export function scalar(text: string): string | undefined {
  const quoted = /^(["'])([^"'\\]*)\1\s*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[2];
  return plainScalar(text.replace(/\s+#.*$/, "").trim());
}

const WORD = /^[A-Za-z0-9._~/:_-]*$/;

/**
 * A plain scalar: one word of safe characters, as before profiles, or several separated by
 * spaces, such as a GPU type. Words that YAML would read as a key or a list item are refused.
 */
function plainScalar(text: string): string | undefined {
  const words = text.split(/ +/);
  if (!words.every((word) => WORD.test(word))) return undefined;
  if (words.length > 1 && (words[0] === "-" || words.some((word) => word.endsWith(":")))) {
    return undefined;
  }
  return text;
}
