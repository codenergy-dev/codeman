import { readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Document, isNode, LineCounter, parseDocument } from "yaml";
import { isScenarioName } from "../../fakes/llm/script.ts";
import type { Scenario } from "./schema.ts";
import { formatPath, Invalid, type Path, validateScenario } from "./validate.ts";

/**
 * Reads scenario files: YAML 1.2 with the core schema, no custom tags, no merge keys, unique keys,
 * and a cap on aliases against expansion bombs; then `validate.ts` turns the data into a
 * `Scenario`. Any problem is a `ScenarioError` that names the file, the field and its line.
 */

export const SCENARIOS_ROOT = fileURLToPath(new URL("../../scenarios/", import.meta.url));
export const FIXTURES_ROOT = fileURLToPath(new URL("../../fixtures/", import.meta.url));

/** How many aliases a file may expand: far above what a scenario needs. */
const MAX_ALIAS_COUNT = 100;

export class ScenarioError extends Error {
  readonly file: string;
  /** The field at fault, such as `actions[3].expect.labels`; empty for a YAML error. */
  readonly field: string;
  /** 1-based; undefined when the YAML node has no position. */
  readonly line: number | undefined;

  constructor(file: string, field: string, line: number | undefined, problem: string) {
    super(
      `${file}${line === undefined ? "" : `:${line}`}: ${field ? `${field}: ` : ""}${problem}.`,
    );
    this.file = file;
    this.field = field;
    this.line = line;
  }
}

export interface LoadOptions {
  /** `e2e/scenarios/`: a scenario's ID is its path under it. */
  root?: string;
  /** `e2e/fixtures/`. */
  fixtures?: string;
}

/** A scenario from its YAML text; `file` names it in errors and gives its ID. */
export function parseScenario(text: string, file: string, options: LoadOptions = {}): Scenario {
  const shown = displayed(file);
  const lines = new LineCounter();
  const document = parseDocument(text, {
    version: "1.2",
    schema: "core",
    customTags: [],
    merge: false,
    uniqueKeys: true,
    stringKeys: true,
    prettyErrors: false,
    lineCounter: lines,
  });
  // Unknown tags are only warnings to the library: here they are errors too.
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) {
    const line = lines.linePos(problem.pos[0]).line;
    throw new ScenarioError(shown, "", line, firstLine(problem.message));
  }
  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (error) {
    throw new ScenarioError(shown, "", undefined, firstLine(String((error as Error).message)));
  }
  const id = scenarioId(file, options.root ?? SCENARIOS_ROOT);
  if (!isScenarioName(id)) {
    throw new ScenarioError(
      shown,
      "",
      undefined,
      `${id} is not a scenario name: letters, digits, '.', '_', '-' and '/'`,
    );
  }
  try {
    return validateScenario(data, { id, file, fixtures: options.fixtures ?? FIXTURES_ROOT });
  } catch (error) {
    if (!(error instanceof Invalid)) throw error;
    throw new ScenarioError(
      shown,
      formatPath(error.path),
      lineOf(document, lines, error.path),
      error.message,
    );
  }
}

export function loadScenario(file: string, options: LoadOptions = {}): Scenario {
  return parseScenario(readFileSync(file, "utf8"), resolve(file), options);
}

/** Every `.yaml` file under `root`, sorted. */
export function scenarioFiles(root: string = SCENARIOS_ROOT): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

export function loadScenarios(
  root: string = SCENARIOS_ROOT,
  options: LoadOptions = {},
): Scenario[] {
  return scenarioFiles(root).flatMap((file) => byRunner(loadScenario(file, { ...options, root })));
}

/**
 * The scenarios a file makes, one per runner it names: the first keeps the file's ID, each other
 * gets `.<runner>` after it, such as `happy-path/openrouter-to-done.act`. A scenario on act has
 * the tag `act`, so `npm run test:e2e -- act` selects every one.
 */
export function byRunner(scenario: Scenario): Scenario[] {
  return scenario.runners.map((runner, index) => ({
    ...scenario,
    runner,
    id: index === 0 ? scenario.id : `${scenario.id}.${runner}`,
    tags:
      runner === "act" && !scenario.tags.includes("act")
        ? [...scenario.tags, "act"]
        : scenario.tags,
  }));
}

/** Its path under `root` without `.yaml`, with `/`; its base name outside `root`. */
function scenarioId(file: string, root: string): string {
  const inside = relative(resolve(root), resolve(file));
  const path = inside.startsWith("..") || isAbsolute(inside) ? basename(file) : inside;
  return path
    .replace(/\.yaml$/, "")
    .split(sep)
    .join("/");
}

/** The line of the node at `path`, or of its nearest ancestor that is in the file. */
function lineOf(document: Document, lines: LineCounter, path: Path): number | undefined {
  for (let length = path.length; length >= 0; length--) {
    let node: unknown;
    try {
      node = length === 0 ? document.contents : document.getIn(path.slice(0, length), true);
    } catch {
      continue;
    }
    if (isNode(node) && node.range) return lines.linePos(node.range[0]).line;
  }
  return undefined;
}

function displayed(file: string): string {
  const shown = relative(process.cwd(), file);
  return shown.startsWith("..") || isAbsolute(shown) ? file : shown;
}

function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).replace(/\.$/, "");
}
