import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { storeContract } from "./contract.ts";
import { Firestore } from "./firestore.ts";

/**
 * The store's contract on Firestore's emulator: the one `FIRESTORE_EMULATOR_HOST` names, or one
 * started here from Firebase's cache (`~/.cache/firebase/emulators/`) with Java. Skipped when
 * neither is there, as in CI. Each test gets a project of its own, so they share no documents.
 */
const RULES = "firebase/firestore.rules";
const external = process.env.FIRESTORE_EMULATOR_HOST;
const jar = emulatorJar();
const skip =
  !external && !jar
    ? "no Firestore emulator: set FIRESTORE_EMULATOR_HOST, or install it in Firebase's cache and Java"
    : false;

const started: ChildProcess[] = [];
let host = external ?? "";

before(async () => {
  if (skip || external || !jar) return;
  host = await startEmulator(jar);
});
after(() => {
  for (const emulator of started) emulator.kill();
});

storeContract("Firestore emulator", () => Firestore.emulator(host, project()), { skip });

const rulesSkip = jar
  ? false
  : "loading the rules needs the emulator in Firebase's cache, and Java";
test("Firestore emulator: the security rules deny every client", { skip: rulesSkip }, async () => {
  if (!jar) return;
  const ruled = await startEmulator(jar, ["--rules", RULES]);
  const store = Firestore.emulator(ruled, project());
  await assert.rejects(store.get("organizations/o"), /403 PERMISSION_DENIED/);
  await assert.rejects(
    store.write([{ op: "create", path: "organizations/o", fields: {} }]),
    /403 PERMISSION_DENIED/,
  );
});

function project(): string {
  return `codeman-test-${randomBytes(4).toString("hex")}`;
}

/** The newest emulator in Firebase's cache, when Java can run it. */
function emulatorJar(): string | undefined {
  const dir = join(homedir(), ".cache", "firebase", "emulators");
  if (!existsSync(dir)) return undefined;
  const jars = readdirSync(dir)
    .filter((name) => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const newest = jars.at(-1);
  if (!newest || spawnSync("java", ["-version"], { stdio: "ignore" }).status !== 0) {
    return undefined;
  }
  return join(dir, newest);
}

/** Starts an emulator on a free port of the loopback, and waits until it answers. */
async function startEmulator(path: string, args: readonly string[] = []): Promise<string> {
  const port = await freePort();
  const emulator = spawn("java", ["-jar", path, "--host=127.0.0.1", `--port=${port}`, ...args], {
    stdio: "ignore",
  });
  started.push(emulator);
  const address = `127.0.0.1:${port}`;
  for (let waited = 0; waited < 60_000; waited += 250) {
    if (emulator.exitCode !== null) throw new Error("Firestore's emulator exited at start.");
    const up = await fetch(`http://${address}/`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return address;
    await sleep(250);
  }
  throw new Error("Firestore's emulator did not start within a minute.");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No port.")),
      );
    });
  });
}
