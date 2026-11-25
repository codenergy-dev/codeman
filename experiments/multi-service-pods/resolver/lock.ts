// Locks an engine's wheel set with uv, in its official image pinned by digest: one pylock.toml
// (PEP 751) per cooldown, with each wheel's URL, SHA-256, size and upload time.
//
// Usage: node lock.ts <engine> [cooldown ...]
//   <engine>    a directory of engines/ holding a pyproject.toml
//   [cooldown]  uv's --exclude-newer values: "none" or a duration such as "14 days" (default:
//               none, 7 days, 14 days, 30 days). "14 days+fixes" also applies the bypass rule
//               from out/fixes.<engine>.json, which resolve-wheels.ts writes: a floor per
//               advisory's fix, and --exclude-newer-package for each fix younger than 14 days;
//               "14 days+fixes-strict" also makes each version of the plain lock a floor.
//               FIX_SEVERITIES=HIGH,CRITICAL limits the floors to advisories of those severities.
// Each duration becomes an absolute --exclude-newer date counted back from LOCK_AT (an ISO 8601
// date, default now), and "none" becomes LOCK_AT itself, so a lock can be made again. RELATIVE=1
// passes the duration to uv as given instead (uv 0.13.1 accepts "14 days").
// Writes out/pylock.<engine>-<label>.toml (PEP 751's naming) and its uv log for each, whose first
// line is the --exclude-newer value used.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, PLATFORM, UV_IMAGE } from "./lib.ts";

const [engine, ...args] = process.argv.slice(2);
if (!engine) {
  console.error("Usage: node lock.ts <engine> [cooldown ...]");
  process.exit(2);
}
const cooldowns = args.length ? args : ["none", "7 days", "14 days", "30 days"];
const input = join(import.meta.dirname, "engines", engine);
const lockAt = new Date(process.env.LOCK_AT ?? Date.now());

/** The --exclude-newer value for a cooldown such as "14 days" or "none". */
function excludeNewer(cooldown: string): string {
  if (process.env.RELATIVE === "1" && cooldown !== "none") return cooldown;
  const days = cooldown === "none" ? 0 : Number.parseInt(cooldown, 10);
  return new Date(lockAt.getTime() - days * 86_400_000).toISOString();
}
mkdirSync(OUT, { recursive: true });

for (const arg of cooldowns) {
  const [cooldown, fixes] = arg.split("+");
  const label =
    (cooldown === "none" ? "latest" : `${cooldown.split(" ")[0]}d`) +
    (fixes ? `-${fixes.replace("fixes", "fixed")}` : "");
  const extra: string[] = [];
  if (fixes) {
    const fixFile = JSON.parse(readFileSync(join(OUT, `fixes.${engine}.json`), "utf8"));
    const { allowNewer, noDowngrade, severities } = fixFile;
    // FIX_SEVERITIES=HIGH,CRITICAL raises only the packages with an advisory of those severities.
    const only = process.env.FIX_SEVERITIES?.split(",");
    const floors = Object.fromEntries(
      Object.entries(fixFile.floors).filter(
        ([name]) => !only || severities[name].some((s: string) => only.includes(s)),
      ),
    );
    // "+fixes" raises only the fixed packages; "+fixes-strict" also forbids any downgrade.
    const all = fixes === "fixes-strict" ? { ...noDowngrade, ...floors } : floors;
    const constraints = Object.entries(all).map(([name, version]) => `${name}>=${version}`);
    writeFileSync(join(OUT, `constraints.${engine}.txt`), `${constraints.join("\n")}\n`);
    extra.push("-c", `/out/constraints.${engine}.txt`);
    for (const [name, date] of Object.entries(allowNewer).filter(([name]) => name in floors))
      extra.push("--exclude-newer-package", `${name}=${date}`);
  }
  const lock = `pylock.${engine}-${label}.toml`;
  const started = Date.now();
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--memory",
      "2g",
      "--cpus",
      "2",
      "-v",
      `${input}:/in:ro`,
      "-v",
      `${OUT}:/out`,
      "-w",
      "/in",
      UV_IMAGE,
      "uv",
      "pip",
      "compile",
      "pyproject.toml",
      "--python-version",
      "3.12",
      "--python-platform",
      PLATFORM,
      "--only-binary",
      ":all:",
      "--generate-hashes",
      "--no-header",
      "--exclude-newer",
      excludeNewer(cooldown),
      ...extra,
      "-o",
      `/out/${lock}`,
    ],
    { encoding: "utf8" },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const exceptions = extra.flatMap((a, i) =>
    extra[i - 1] === "--exclude-newer-package" ? [a] : [],
  );
  writeFileSync(
    join(OUT, `pylock.${engine}-${label}.log`),
    `exclude-newer: ${excludeNewer(cooldown)}\nexclude-newer-package: ${exceptions.join(" ")}\n${result.stderr}`,
  );
  console.log(`${engine} ${label}: exit ${result.status} in ${seconds}s -> out/${lock}`);
  if (result.status !== 0) {
    console.log(result.stderr.split("\n").slice(-25).join("\n"));
    process.exitCode = 1;
  }
}
