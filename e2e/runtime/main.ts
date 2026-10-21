import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { memoryProblem } from "./compose.ts";
import { dockerMemory } from "./docker.ts";
import { runnerProblem, selectScenarios } from "./scenario/filter.ts";
import { loadScenarios, SCENARIOS_ROOT } from "./scenario/load.ts";
import type { Profile, Scenario } from "./scenario/schema.ts";
import { ROOT, type ScenarioResult, Session } from "./session.ts";

/**
 * `npm run test:e2e [-- <paths or tags>] [--down] [--no-build]`: builds the e2e bundle, starts
 * the suite's services with Compose (or reuses them), runs the selected scenarios one at a time,
 * and prints a summary. `--down` stops the services afterwards; `--no-build` keeps the images
 * Compose has. Exits 1 when a scenario fails.
 *
 * A scenario tagged `known-bug` reproduces a bug of Codeman not fixed yet: it is expected to
 * fail, and its result is reported apart. Its failure does not fail the suite; its pass does, so
 * the tag goes once the bug is fixed.
 */

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const unknown = [...flags].filter((flag) => !["--down", "--no-build"].includes(flag));
if (unknown.length > 0) {
  console.error(`Unknown option ${unknown.join(", ")}; the options are --down and --no-build.`);
  process.exit(2);
}
const selectors = args.filter((arg) => !arg.startsWith("--"));
const log = (text: string) => console.log(`[e2e] ${text}`);

const scenarios = selectScenarios(loadScenarios(), selectors, {
  cwd: process.cwd(),
  root: SCENARIOS_ROOT,
});
const profiles = [...new Set(scenarios.flatMap((scenario) => scenario.profiles))] as Profile[];
log(
  `${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"}: ${scenarios.map((one) => one.id).join(", ")}.`,
);

// A runner the runtime does not have, and (decision 7) a profile Docker's memory cannot hold, are
// refused before anything starts.
const problem = runnerProblem(scenarios) ?? memoryProblem(profiles, await dockerMemory());
if (problem) {
  console.error(`[e2e] ${problem}`);
  process.exit(1);
}

log("Building the e2e bundle (npm run build:e2e).");
const built = spawnSync(process.execPath, ["scripts/build.ts", "--e2e"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

const session = await Session.open({ profiles, build: !flags.has("--no-build"), log });
const results: ScenarioResult[] = [];
let interrupted = false;
process.once("SIGINT", () => {
  interrupted = true;
  log("Interrupted: the scenario running now is the last.");
});
try {
  for (const scenario of scenarios) {
    if (interrupted) break;
    log(`Running ${scenario.id}: ${scenario.name}`);
    const result = await session.runScenario(scenario);
    results.push(result);
    const seconds = (result.durationMs / 1000).toFixed(1);
    if (knownBug(scenario)) {
      log(
        result.passed
          ? `PASS ${scenario.id} (${seconds}s), but it is tagged known-bug: is the bug fixed? Remove the tag.`
          : `KNOWN BUG ${scenario.id} (${seconds}s): fails as expected.`,
      );
      if (!result.passed) console.log(result.message?.replace(/^/gm, "  "));
    } else if (result.passed) log(`PASS ${scenario.id} (${seconds}s)`);
    else {
      log(`FAIL ${scenario.id} (${seconds}s)`);
      console.log(result.message?.replace(/^/gm, "  "));
    }
  }
} finally {
  await session.close({ down: flags.has("--down") });
}

const known = results.filter((result) => knownBug(result.scenario));
const counted = results.filter((result) => !knownBug(result.scenario));
const failed = counted.filter((result) => !result.passed);
// A known bug's scenario that passes fails the suite: its tag is out of date.
const fixed = known.filter((result) => result.passed);
const line = (result: ScenarioResult, status: string) =>
  `  ${status.padEnd(9)} ${(result.durationMs / 1000).toFixed(1).padStart(7)}s  ${result.scenario.id}  (${relative(process.cwd(), result.scenario.file)})`;
console.log("");
console.log("Summary:");
for (const result of counted) console.log(line(result, result.passed ? "pass" : "FAIL"));
if (known.length > 0) {
  console.log("Known bugs of Codeman (tagged known-bug):");
  for (const result of known) console.log(line(result, result.passed ? "PASSES" : "reproduced"));
}
console.log(
  `${counted.length - failed.length} passed, ${failed.length} failed${known.length > 0 ? `; ${known.length - fixed.length} known bugs reproduced, ${fixed.length} no longer fail` : ""}${results.length < scenarios.length ? `, ${scenarios.length - results.length} not run` : ""}.`,
);
process.exit(failed.length > 0 || fixed.length > 0 || results.length < scenarios.length ? 1 : 0);

function knownBug(scenario: Scenario): boolean {
  return scenario.tags.includes("known-bug");
}
