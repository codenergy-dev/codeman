/**
 * The pod's entry command, as the providers' create APIs take it, built from bootstrap.sh: one
 * argument per line of the script, comments and blank lines left out, which a fixed `sh -c` joins
 * back and runs. Salad's `container.command` takes at most 100 items of 1 to 1000 characters,
 * each matching `^.*$`, so a single line; Runpod's `entrypoint` and `cmd` state no limit but the
 * whole request's 102,400 bytes (docs/web/salad/create-container-group.md,
 * docs/web/runpod/runpod-rest-api.md). Fails when the script breaks Salad's limits.
 *
 * Usage: node experiments/multi-service-pods/bootstrap/command.ts [lines-file]
 *   Prints the Salad and Runpod fields as JSON; with lines-file, also writes the command there,
 *   one argument per line, for run.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";

const script = readFileSync(new URL("bootstrap.sh", import.meta.url), "utf8");
// The shebang, comment lines and blank lines carry nothing the shell runs.
const lines = script.split("\n").filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
// `$0` is "bootstrap"; the lines are `$1`, `$2`…, each printed back with its newline.
const command = ["/bin/sh", "-c", 'eval "$(printf \'%s\\n\' "$@")"', "bootstrap", ...lines];

const problems = [
  ...(command.length > 100 ? [`${command.length} items, above Salad's 100`] : []),
  ...command
    .filter((item) => item.length > 1000)
    .map((item) => `an item of ${item.length} characters: ${item.slice(0, 40)}…`),
];
if (problems.length > 0) {
  console.error(`The command breaks Salad's limits: ${problems.join("; ")}.`);
  process.exit(1);
}

const [entrypoint, ...cmd] = command;
console.log(
  JSON.stringify(
    {
      items: command.length,
      longestItem: Math.max(...command.map((item) => item.length)),
      totalCharacters: command.reduce((sum, item) => sum + item.length, 0),
      scriptCharacters: script.length,
      salad: { container: { command } },
      runpod: { entrypoint: [entrypoint], cmd },
    },
    null,
    2,
  ),
);
const out = process.argv[2];
if (out) writeFileSync(out, `${command.join("\n")}\n`);
