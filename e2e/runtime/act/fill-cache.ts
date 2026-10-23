import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INTERNAL } from "../fakes.ts";
import { fillCache, pinnedActions } from "./cache.ts";
import { ACT_STATE } from "./driver.ts";

/**
 * `node e2e/runtime/act/fill-cache.ts [--from <owner>/<repo>=<local clone> ...]`: clones each
 * action the templates pin into act's action cache (e2e/.out/act/actions/), once. A pin comes from
 * the local clone `--from` names, or else from github.com, anonymously: git runs with no user or
 * system configuration, so no credential helper, and no prompt. Each clone is checked out at its
 * pinned commit, whose ID git checks against the content. See docs/development/e2e/suite.md#under-act.
 */

const args = process.argv.slice(2);
const sources: Record<string, string> = {};
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  const value = arg === "--from" ? args[++index] : undefined;
  const [name, dir] = value?.split("=") ?? [];
  if (!name || !dir) {
    console.error("Usage: node e2e/runtime/act/fill-cache.ts [--from <owner>/<repo>=<dir> ...]");
    process.exit(2);
  }
  sources[name] = dir;
}

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const templates = ["codeman.yml", "codeman-task.yml"];
const actions = pinnedActions(
  Object.fromEntries(
    templates.map((file) => [file, readFileSync(join(ROOT, "templates", file), "utf8")]),
  ),
);
await fillCache(ACT_STATE.actions, actions, {
  server: INTERNAL.github,
  sources,
  log: (line) => console.log(line),
});
console.log(`act's action cache holds the ${actions.length} pinned actions: ${ACT_STATE.actions}`);
