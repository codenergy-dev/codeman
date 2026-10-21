import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Scenario } from "./schema.ts";

/** A bare word: a tag, or a directory or file directly under `e2e/scenarios/`. */
const TAG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The scenarios `npm run test:e2e -- <paths or tags>` runs: those under any path given, or with
 * any tag given; all of them when nothing is given. A bare word, such as `pods`, is a tag and a
 * path under `e2e/scenarios/`. Any other argument is a path, from the working directory or else
 * from `e2e/scenarios/`. An argument that matches no scenario is an error, so a typo fails
 * instead of running nothing.
 */
export function selectScenarios(
  scenarios: readonly Scenario[],
  args: readonly string[],
  options: { cwd: string; root: string },
): Scenario[] {
  if (args.length === 0) return [...scenarios];
  const chosen = new Set<Scenario>();
  for (const arg of args) {
    const path = pathOf(arg, options);
    const tag = TAG.test(arg);
    const matches = scenarios.filter(
      (scenario) => (tag && scenario.tags.includes(arg)) || within(resolve(scenario.file), path),
    );
    if (matches.length === 0) throw new Error(`No scenario has the tag or is under ${arg}.`);
    for (const scenario of matches) chosen.add(scenario);
  }
  return scenarios.filter((scenario) => chosen.has(scenario));
}

function pathOf(arg: string, options: { cwd: string; root: string }): string {
  const underRoot = resolve(options.root, arg);
  if (TAG.test(arg)) return underRoot;
  const fromCwd = resolve(options.cwd, arg);
  return existsSync(fromCwd) || !existsSync(underRoot) ? fromCwd : underRoot;
}

function within(file: string, path: string): boolean {
  return file === path || file.startsWith(path.endsWith(sep) ? path : `${path}${sep}`);
}
