/**
 * Installs a Python secondary engine inside the pod (E4 of
 * docs/plans/2026-10-30-investigate-multi-service-pods.md), from resolutions made outside it:
 *   1. Python: the image's python3 when it has one; otherwise a standalone CPython, downloaded
 *      and verified, then extracted.
 *   2. The wheels: downloaded and verified (downloader.ts), every one or none.
 *   3. A virtual environment, with `pip install --no-index --no-deps --only-binary :all:
 *      --require-hashes` from the verified files only, then `pip check`.
 * Prints each step's time and the disk each part uses.
 *
 * Usage: node install.ts <python resolution.json> <wheels resolution.json> <engine directory>
 *   The engine directory must be new or empty. Writes <engine>/python, <engine>/wheels, <engine>/venv.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { download, readResolution } from "./downloader.ts";

const [pythonFile, wheelsFile, engineArgument] = process.argv.slice(2);
if (!pythonFile || !wheelsFile || !engineArgument) {
  console.error("Usage: node install.ts <python.json> <wheels.json> <engine directory>");
  process.exit(2);
}
const engine = resolve(engineArgument);
const timings: Record<string, number> = {};

function step<T>(name: string, work: () => T): T {
  const started = Date.now();
  const result = work();
  timings[name] = (Date.now() - started) / 1000;
  console.log(`${name}: ${timings[name].toFixed(1)} s`);
  return result;
}

async function stepAsync<T>(name: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await work();
  timings[name] = (Date.now() - started) / 1000;
  console.log(`${name}: ${timings[name].toFixed(1)} s`);
  return result;
}

function run(file: string, args: string[]): string {
  // No inherited configuration: pip reads no config file, no index, no user site.
  return execFileSync(file, args, {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", PIP_CONFIG_FILE: "/dev/null", PYTHONNOUSERSITE: "1" },
  });
}

function du(path: string): number {
  return Number(run("du", ["-sb", path]).split("\t")[0]);
}

const python = readResolution(pythonFile);
const wheels = readResolution(wheelsFile);
mkdirSync(engine, { recursive: true });
if (readdirSync(engine).length > 0) throw new Error(`${engine} is not empty.`);

let interpreter = "";
try {
  interpreter = run("sh", ["-c", "command -v python3"]).trim();
} catch {
  // The image has no Python: the usual case for Ollama's.
}
let pythonDownload = 0;
if (interpreter) {
  console.log(`The image has ${interpreter}.`);
} else {
  console.log("The image has no python3: downloading a standalone CPython.");
  const archive = join(engine, "python-archive");
  pythonDownload = (await stepAsync("download python", () => download(python, archive))).bytes;
  const file = readdirSync(archive)[0] as string;
  // The archive holds one directory, `python/`.
  step("extract python", () => run("tar", ["-xzf", join(archive, file), "-C", engine]));
  run("rm", ["-rf", archive]);
  interpreter = join(engine, "python", "bin", "python3");
}
console.log(run(interpreter, ["-I", "--version"]).trim());

const wheelDir = join(engine, "wheels");
const downloaded = await stepAsync("download wheels", () => download(wheels, wheelDir));

const venv = join(engine, "venv");
step("create venv", () => run(interpreter, ["-I", "-m", "venv", venv]));
// Each wheel by name, version and hash: pip refuses any file whose hash differs, and any
// requirement without one.
const requirements = join(engine, "requirements.txt");
writeFileSync(
  requirements,
  wheels.artifacts
    .map((artifact) => `${artifact.name}==${artifact.version} --hash=sha256:${artifact.sha256}\n`)
    .join(""),
);
const pip = join(venv, "bin", "python");
step("pip install", () =>
  run(pip, [
    "-I",
    "-m",
    "pip",
    "install",
    "--no-index",
    "--find-links",
    wheelDir,
    "--no-deps",
    "--only-binary",
    ":all:",
    "--require-hashes",
    "--no-cache-dir",
    "--disable-pip-version-check",
    "-r",
    requirements,
  ]),
);
// --no-deps trusts the resolution to be complete: pip check says whether it was.
const check = step("pip check", () => run(pip, ["-I", "-m", "pip", "check"]).trim());
console.log(check);

const disk = {
  python: interpreter.startsWith(engine) ? du(join(engine, "python")) : 0,
  wheels: du(wheelDir),
  venv: du(venv),
};
console.log(
  JSON.stringify(
    {
      wheels: wheels.artifacts.length,
      downloadBytes: { python: pythonDownload, wheels: downloaded.bytes },
      seconds: timings,
      diskBytes: disk,
    },
    null,
    2,
  ),
);
