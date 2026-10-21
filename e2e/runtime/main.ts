import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { memoryProblem } from "./compose.ts";
import { dockerMemory } from "./docker.ts";
import { selectScenarios } from "./scenario/filter.ts";
import { loadScenarios, SCENARIOS_ROOT } from "./scenario/load.ts";
import type { Profile } from "./scenario/schema.ts";
import { ROOT, type ScenarioResult, Session } from "./session.ts";

/**
 * `npm run test:e2e [-- <paths or tags>] [--down] [--no-build]`: builds the e2e bundle, starts
 * the suite's services with Compose (or reuses them), runs the selected scenarios one at a time,
 * and prints a summary. `--down` stops the services afterwards; `--no-build` keeps the images
 * Compose has. Exits 1 when a scenario fails.
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

// Decision 7: a profile Docker's memory cannot hold is refused before anything starts.
const problem = memoryProblem(profiles, await dockerMemory());
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
    if (result.passed) log(`PASS ${scenario.id} (${seconds}s)`);
    else {
      log(`FAIL ${scenario.id} (${seconds}s)`);
      console.log(result.message?.replace(/^/gm, "  "));
    }
  }
} finally {
  await session.close({ down: flags.has("--down") });
}

const failed = results.filter((result) => !result.passed);
console.log("");
console.log("Summary:");
for (const result of results) {
  const where = relative(process.cwd(), result.scenario.file);
  console.log(
    `  ${result.passed ? "pass" : "FAIL"}  ${(result.durationMs / 1000).toFixed(1).padStart(7)}s  ${result.scenario.id}  (${where})`,
  );
}
console.log(
  `${results.length - failed.length} passed, ${failed.length} failed${results.length < scenarios.length ? `, ${scenarios.length - results.length} not run` : ""}.`,
);
process.exit(failed.length > 0 || results.length < scenarios.length ? 1 : 0);
