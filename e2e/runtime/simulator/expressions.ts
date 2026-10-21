/**
 * GitHub Actions expressions, for the subset Codeman's templates use: the contexts `github`,
 * `inputs`, `needs`, `steps`, `matrix`, `strategy`, `secrets`, `vars`, `env`, `runner`, `job` and
 * `jobs`; literals; property access with `.name`, `['name']` and the `.*` filter; the operators
 * `!`, `==`, `!=`, `&&`, `||` and parentheses; and the functions `always`, `success`, `failure`,
 * `cancelled`, `fromJSON`, `toJSON`, `contains`, `startsWith`, `endsWith`, `format` and `join`.
 *
 * Values follow GitHub's rules: loose equality that coerces mismatched types to numbers and
 * compares strings ignoring case, JavaScript-like truthiness, `&&` and `||` that return an
 * operand, and case-insensitive property names. Anything else throws an `ExpressionError` that
 * names the expression, its file and its key, so a template that starts using it is noticed.
 */

/** A context's name, as expressions write it. */
export const CONTEXTS = [
  "github",
  "inputs",
  "needs",
  "steps",
  "matrix",
  "strategy",
  "secrets",
  "vars",
  "env",
  "runner",
  "job",
  "jobs",
] as const;
export type ContextName = (typeof CONTEXTS)[number];

/** Where an expression is, and what it may use there. */
export interface Scope {
  file: string;
  /** The key path, such as `jobs.select.if`. */
  key: string;
  /** The contexts GitHub makes available at that key. */
  contexts: readonly ContextName[];
  /** Whether `always()`, `success()`, `failure()` and `cancelled()` may be called. */
  status?: boolean;
}

/** What each kind of key may use, from GitHub's table of context availability. */
export const AVAILABILITY = {
  "run-name": ["github", "inputs", "vars"],
  concurrency: ["github", "inputs", "vars"],
  "workflow.env": ["github", "secrets", "inputs", "vars"],
  "call.outputs": ["github", "jobs", "vars", "inputs"],
  "job.if": ["github", "needs", "vars", "inputs"],
  "job.name": ["github", "needs", "strategy", "matrix", "vars", "inputs"],
  "job.strategy": ["github", "needs", "vars", "inputs"],
  "job.with": ["github", "needs", "strategy", "matrix", "inputs", "vars"],
  "job.secrets": ["github", "needs", "strategy", "matrix", "secrets", "inputs", "vars"],
  "job.env": ["github", "needs", "strategy", "matrix", "vars", "secrets", "inputs"],
  "job.outputs": [
    "github",
    "needs",
    "strategy",
    "matrix",
    "job",
    "runner",
    "env",
    "vars",
    "secrets",
    "steps",
    "inputs",
  ],
  "step.if": [
    "github",
    "needs",
    "strategy",
    "matrix",
    "job",
    "runner",
    "env",
    "vars",
    "steps",
    "inputs",
  ],
  step: [
    "github",
    "needs",
    "strategy",
    "matrix",
    "job",
    "runner",
    "env",
    "vars",
    "secrets",
    "steps",
    "inputs",
  ],
  none: [],
} as const satisfies Record<string, readonly ContextName[]>;
export type KeyKind = keyof typeof AVAILABILITY;

/** The status functions' answers where they may be called. */
export interface Status {
  success(): boolean;
  failure(): boolean;
  cancelled(): boolean;
}

/** The contexts' values; a missing context reads as null. */
export type Contexts = Partial<Record<ContextName, unknown>>;

/** A construct outside the supported subset, or a syntax error. */
export class ExpressionError extends Error {
  constructor(scope: Pick<Scope, "file" | "key">, expression: string, detail: string) {
    super(`${scope.file}: ${scope.key}: \${{ ${expression.trim()} }}: ${detail}`);
    this.name = "ExpressionError";
  }
}

/** An error GitHub also raises at run time, such as `fromJSON` of text that is not JSON. */
export class EvaluationError extends Error {
  constructor(scope: Pick<Scope, "file" | "key">, expression: string, detail: string) {
    super(`${scope.file}: ${scope.key}: \${{ ${expression.trim()} }}: ${detail}`);
    this.name = "EvaluationError";
  }
}

export type Node =
  | { kind: "literal"; value: null | boolean | number | string }
  | { kind: "context"; name: ContextName }
  | { kind: "property"; object: Node; name: string }
  | { kind: "index"; object: Node; index: Node }
  | { kind: "filter"; object: Node }
  | { kind: "call"; name: FunctionName; args: Node[] }
  | { kind: "not"; operand: Node }
  | { kind: "binary"; operator: "==" | "!=" | "&&" | "||"; left: Node; right: Node };

const FUNCTIONS = {
  always: [0, 0],
  success: [0, 0],
  failure: [0, 0],
  cancelled: [0, 0],
  fromjson: [1, 1],
  tojson: [1, 1],
  contains: [2, 2],
  startswith: [2, 2],
  endswith: [2, 2],
  format: [1, Number.POSITIVE_INFINITY],
  join: [1, 2],
} as const;
type FunctionName = keyof typeof FUNCTIONS;
const STATUS_FUNCTIONS = new Set<FunctionName>(["always", "success", "failure", "cancelled"]);

type Token =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "word"; value: string }
  | { type: "punct"; value: string };

function tokenize(text: string, fail: (detail: string) => never): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const operandExpected = () => {
    const last = tokens.at(-1);
    return !last || (last.type === "punct" && !["]", ")", "*"].includes(last.value));
  };
  while (at < text.length) {
    const char = text[at] ?? "";
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (char === "'") {
      let value = "";
      at++;
      for (;;) {
        if (at >= text.length) fail("an unterminated string");
        if (text[at] === "'") {
          if (text[at + 1] === "'") {
            value += "'";
            at += 2;
            continue;
          }
          at++;
          break;
        }
        value += text[at];
        at++;
      }
      tokens.push({ type: "string", value });
      continue;
    }
    if (/[0-9]/.test(char) || (char === "-" && operandExpected())) {
      const number = /^(-?)(0x[0-9a-fA-F]+|[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?)/.exec(
        text.slice(at),
      );
      if (number) {
        const magnitude = Number(number[2]);
        tokens.push({ type: "number", value: number[1] ? -magnitude : magnitude });
        at += number[0].length;
        continue;
      }
    }
    const word = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(at));
    if (word) {
      tokens.push({ type: "word", value: word[0] });
      at += word[0].length;
      continue;
    }
    const two = text.slice(at, at + 2);
    if (["==", "!=", "&&", "||", "<=", ">="].includes(two)) {
      tokens.push({ type: "punct", value: two });
      at += 2;
      continue;
    }
    if ("()[].,!*<>".includes(char)) {
      tokens.push({ type: "punct", value: char });
      at++;
      continue;
    }
    fail(`the character ${JSON.stringify(char)} is not supported`);
  }
  return tokens;
}

/** Parses an expression, without `${{ }}`; throws an `ExpressionError` outside the subset. */
export function parse(expression: string, scope: Scope): Node {
  const fail = (detail: string): never => {
    throw new ExpressionError(scope, expression, detail);
  };
  const tokens = tokenize(expression, fail);
  let at = 0;
  const peek = () => tokens[at];
  const isPunct = (value: string) => {
    const token = peek();
    return token?.type === "punct" && token.value === value;
  };
  const expect = (value: string) => {
    if (!isPunct(value)) fail(`expected ${value}`);
    at++;
  };

  const or = (): Node => {
    let left = and();
    while (isPunct("||")) {
      at++;
      left = { kind: "binary", operator: "||", left, right: and() };
    }
    return left;
  };
  const and = (): Node => {
    let left = equality();
    while (isPunct("&&")) {
      at++;
      left = { kind: "binary", operator: "&&", left, right: equality() };
    }
    return left;
  };
  const equality = (): Node => {
    let left = unary();
    for (;;) {
      if (isPunct("==") || isPunct("!=")) {
        const operator = (peek() as { value: "==" | "!=" }).value;
        at++;
        left = { kind: "binary", operator, left, right: unary() };
        continue;
      }
      if (isPunct("<") || isPunct(">") || isPunct("<=") || isPunct(">=")) {
        fail(`the operator ${(peek() as { value: string }).value} is not supported`);
      }
      return left;
    }
  };
  const unary = (): Node => {
    if (isPunct("!")) {
      at++;
      return { kind: "not", operand: unary() };
    }
    return postfix(primary());
  };
  const postfix = (node: Node): Node => {
    for (;;) {
      if (isPunct(".")) {
        at++;
        const next = peek();
        if (next?.type === "punct" && next.value === "*") {
          at++;
          node = { kind: "filter", object: node };
          continue;
        }
        if (next?.type !== "word") fail("expected a property name after .");
        at++;
        node = { kind: "property", object: node, name: (next as { value: string }).value };
        continue;
      }
      if (isPunct("[")) {
        at++;
        if (isPunct("*")) {
          at++;
          expect("]");
          node = { kind: "filter", object: node };
          continue;
        }
        const index = or();
        expect("]");
        node = { kind: "index", object: node, index };
        continue;
      }
      return node;
    }
  };
  const primary = (): Node => {
    const token = peek();
    if (!token) return fail("the expression ends early");
    at++;
    if (token.type === "string" || token.type === "number") {
      return { kind: "literal", value: token.value };
    }
    if (token.type === "punct") {
      if (token.value === "(") {
        const inner = or();
        expect(")");
        return inner;
      }
      return fail(`unexpected ${token.value}`);
    }
    const word = token.value;
    if (isPunct("(")) {
      at++;
      const name = word.toLowerCase();
      if (!(name in FUNCTIONS)) fail(`the function ${word} is not supported`);
      const fn = name as FunctionName;
      if (STATUS_FUNCTIONS.has(fn) && !scope.status) {
        fail(`${word}() may only be used in an if`);
      }
      const args: Node[] = [];
      if (!isPunct(")")) {
        for (;;) {
          args.push(or());
          if (!isPunct(",")) break;
          at++;
        }
      }
      expect(")");
      const [min, max] = FUNCTIONS[fn];
      if (args.length < min || args.length > max) {
        fail(`${word} takes ${min === max ? min : `${min} or more`} arguments`);
      }
      return { kind: "call", name: fn, args };
    }
    if (word === "true" || word === "false") return { kind: "literal", value: word === "true" };
    if (word === "null") return { kind: "literal", value: null };
    const name = word.toLowerCase() as ContextName;
    if (!(CONTEXTS as readonly string[]).includes(name)) {
      fail(`${word} is not a supported context`);
    }
    if (!scope.contexts.includes(name)) fail(`the ${name} context is not available here`);
    return { kind: "context", name };
  };

  const node = or();
  if (at < tokens.length) fail(`unexpected ${JSON.stringify(peek()?.value)}`);
  return node;
}

/** Whether the expression calls a status function, so `if:` adds no implicit `success()`. */
export function callsStatus(node: Node): boolean {
  switch (node.kind) {
    case "call":
      return STATUS_FUNCTIONS.has(node.name) || node.args.some(callsStatus);
    case "property":
    case "filter":
      return callsStatus(node.object);
    case "index":
      return callsStatus(node.object) || callsStatus(node.index);
    case "not":
      return callsStatus(node.operand);
    case "binary":
      return callsStatus(node.left) || callsStatus(node.right);
    default:
      return false;
  }
}

/** The result of a `.*` filter, which later property accesses map over. */
class Filtered {
  readonly items: unknown[];
  constructor(items: unknown[]) {
    this.items = items;
  }
}

function plain(value: unknown): unknown {
  return value instanceof Filtered ? value.items : value === undefined ? null : value;
}

function property(value: unknown, name: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (Object.hasOwn(object, name)) return object[name];
  const lower = name.toLowerCase();
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === lower);
  return key === undefined ? undefined : object[key];
}

/**
 * GitHub's truthiness: false, 0, -0, '' and null are false. No expression of the subset yields
 * NaN, which GitHub's list leaves out; it is false here, as in JavaScript.
 */
export function truthy(value: unknown): boolean {
  const v = plain(value);
  if (v === null || v === false) return false;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v !== "";
  return true;
}

/**
 * GitHub's cast to a number: null 0, booleans 1 and 0, a string by JSON's number syntax (empty is
 * 0, anything else NaN), arrays and objects NaN (docs/web/github/evaluate-expressions-in-workflows-and-actions.md, "Operators").
 */
function toNumber(value: unknown): number {
  const v = plain(value);
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const text = v.trim();
    if (text === "") return 0;
    return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(text) ? Number(text) : Number.NaN;
  }
  return Number.NaN;
}

/** GitHub's `==`: mismatched types compare as numbers, strings ignore case. */
export function looseEquals(left: unknown, right: unknown): boolean {
  const a = plain(left);
  const b = plain(right);
  const type = (value: unknown) =>
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (type(a) === type(b)) {
    if (typeof a === "string" && typeof b === "string") {
      return a.toUpperCase() === b.toUpperCase();
    }
    return a === b;
  }
  const x = toNumber(a);
  const y = toNumber(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x === y;
}

/** A value as `${{ }}` writes it into text. */
export function toText(value: unknown): string {
  const v = plain(value);
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isNaN(v) ? "NaN" : String(v);
  if (typeof v === "string") return v;
  return Array.isArray(v) ? "Array" : "Object";
}

function toJson(value: unknown): string {
  return JSON.stringify(
    plain(value),
    (_key, item) => (item instanceof Filtered ? item.items : item),
    2,
  );
}

/** Evaluates a parsed expression against `contexts`. */
export function evaluateNode(
  node: Node,
  contexts: Contexts,
  scope: Scope,
  expression: string,
  status?: Status,
): unknown {
  const fail = (detail: string): never => {
    throw new EvaluationError(scope, expression, detail);
  };
  const visit = (current: Node): unknown => {
    switch (current.kind) {
      case "literal":
        return current.value;
      case "context":
        return contexts[current.name] ?? null;
      case "property": {
        const object = visit(current.object);
        if (object instanceof Filtered) {
          return new Filtered(
            object.items
              .map((item) => property(item, current.name))
              .filter((item) => item !== undefined),
          );
        }
        return property(object, current.name) ?? null;
      }
      case "index": {
        const object = visit(current.object);
        const index = plain(visit(current.index));
        const at = (value: unknown) => {
          if (Array.isArray(value)) {
            const position = toNumber(index);
            return Number.isInteger(position) ? value[position] : undefined;
          }
          return property(value, toText(index));
        };
        if (object instanceof Filtered) {
          return new Filtered(object.items.map(at).filter((item) => item !== undefined));
        }
        return at(object) ?? null;
      }
      case "filter": {
        const object = visit(current.object);
        const items = (value: unknown): unknown[] =>
          Array.isArray(value)
            ? value
            : value !== null && typeof value === "object"
              ? Object.values(value)
              : [];
        if (object instanceof Filtered) return new Filtered(object.items.flatMap(items));
        return new Filtered(items(object));
      }
      case "not":
        return !truthy(visit(current.operand));
      case "binary": {
        if (current.operator === "&&") {
          const left = visit(current.left);
          return truthy(left) ? plain(visit(current.right)) : plain(left);
        }
        if (current.operator === "||") {
          const left = visit(current.left);
          return truthy(left) ? plain(left) : plain(visit(current.right));
        }
        const equal = looseEquals(visit(current.left), visit(current.right));
        return current.operator === "==" ? equal : !equal;
      }
      case "call":
        return call(current.name, current.args.map(visit));
    }
  };
  const call = (name: FunctionName, args: unknown[]): unknown => {
    const [first, second] = args;
    switch (name) {
      case "always":
        return true;
      case "success":
      case "failure":
      case "cancelled":
        if (!status) return fail(`${name}() has no status here`);
        return status[name]();
      case "fromjson": {
        try {
          return JSON.parse(toText(first));
        } catch {
          return fail(`fromJSON: ${JSON.stringify(toText(first))} is not JSON`);
        }
      }
      case "tojson":
        return toJson(first);
      case "contains": {
        if (first instanceof Filtered || Array.isArray(first)) {
          return (plain(first) as unknown[]).some((item) => looseEquals(item, second));
        }
        return toText(first).toUpperCase().includes(toText(second).toUpperCase());
      }
      case "startswith":
        return toText(first).toUpperCase().startsWith(toText(second).toUpperCase());
      case "endswith":
        return toText(first).toUpperCase().endsWith(toText(second).toUpperCase());
      case "format":
        return format(toText(first), args.slice(1), fail);
      case "join": {
        const separator = args.length > 1 ? toText(second) : ",";
        const list = plain(first);
        return Array.isArray(list) ? list.map(toText).join(separator) : toText(list);
      }
    }
  };
  return plain(visit(node));
}

function format(text: string, args: unknown[], fail: (detail: string) => never): string {
  let out = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "{" && text[at + 1] === "{") {
      out += "{";
      at++;
    } else if (char === "}" && text[at + 1] === "}") {
      out += "}";
      at++;
    } else if (char === "{") {
      const end = text.indexOf("}", at);
      const index = end < 0 ? Number.NaN : Number(text.slice(at + 1, end));
      if (!Number.isInteger(index) || index < 0 || index >= args.length) {
        fail(`format: ${JSON.stringify(text)} has an invalid placeholder`);
      }
      out += toText(args[index]);
      at = end;
    } else if (char === "}") {
      fail(`format: ${JSON.stringify(text)} has an unmatched }`);
    } else {
      out += char;
    }
  }
  return out;
}

/** A text's pieces: literal text, and the expressions between `${{` and `}}`. */
export function splitTemplate(
  text: string,
  scope: Pick<Scope, "file" | "key">,
): (string | { expression: string })[] {
  const parts: (string | { expression: string })[] = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf("${{", at);
    if (start < 0) {
      if (at < text.length) parts.push(text.slice(at));
      return parts;
    }
    if (start > at) parts.push(text.slice(at, start));
    let cursor = start + 3;
    let quoted = false;
    for (;;) {
      if (cursor >= text.length) {
        throw new ExpressionError(scope, text.slice(start + 3), "no closing }}");
      }
      const char = text[cursor];
      if (char === "'") quoted = !quoted;
      else if (!quoted && char === "}" && text[cursor + 1] === "}") break;
      cursor++;
    }
    parts.push({ expression: text.slice(start + 3, cursor) });
    at = cursor + 2;
  }
}

/** The expressions a text holds. */
export function expressionsIn(text: string, scope: Pick<Scope, "file" | "key">): string[] {
  return splitTemplate(text, scope).flatMap((part) =>
    typeof part === "string" ? [] : [part.expression],
  );
}

/** Evaluates one expression, without `${{ }}`. */
export function evaluate(
  expression: string,
  contexts: Contexts,
  scope: Scope,
  status?: Status,
): unknown {
  return evaluateNode(parse(expression, scope), contexts, scope, expression, status);
}

/**
 * A YAML value with its expressions evaluated: a text that is one `${{ }}` alone gives the
 * expression's value, of any type, as GitHub does for `strategy.matrix`; other texts give text.
 */
export function evaluateValue(value: unknown, contexts: Contexts, scope: Scope): unknown {
  if (typeof value !== "string") return value;
  const parts = splitTemplate(value, scope);
  const [only] = parts;
  if (parts.length === 1 && typeof only === "object") {
    return evaluate(only.expression, contexts, scope);
  }
  return parts
    .map((part) =>
      typeof part === "string" ? part : toText(evaluate(part.expression, contexts, scope)),
    )
    .join("");
}

/** A YAML value as text, with its expressions written in. */
export function interpolate(value: unknown, contexts: Contexts, scope: Scope): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return toText(value);
  return splitTemplate(value, scope)
    .map((part) =>
      typeof part === "string" ? part : toText(evaluate(part.expression, contexts, scope)),
    )
    .join("");
}

/** The expression of an `if:`: its text, with or without `${{ }}`. */
export function conditionExpression(value: unknown, scope: Pick<Scope, "file" | "key">): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value !== "string") {
    throw new ExpressionError(scope, String(value), "an if must be text");
  }
  if (!value.includes("${{")) return value;
  const parts = splitTemplate(value.trim(), scope);
  const [only] = parts;
  if (parts.length !== 1 || typeof only !== "object") {
    throw new ExpressionError(
      scope,
      value,
      "an if that mixes text and an expression is not supported",
    );
  }
  return only.expression;
}

/** Evaluates an `if:`, with GitHub's implicit `success() &&` when it calls no status function. */
export function evaluateCondition(
  value: unknown,
  contexts: Contexts,
  scope: Scope,
  status: Status,
): boolean {
  const expression = conditionExpression(value, scope);
  const node = parse(expression, { ...scope, status: true });
  const guarded: Node = callsStatus(node)
    ? node
    : {
        kind: "binary",
        operator: "&&",
        left: { kind: "call", name: "success", args: [] },
        right: node,
      };
  return truthy(evaluateNode(guarded, contexts, { ...scope, status: true }, expression, status));
}
