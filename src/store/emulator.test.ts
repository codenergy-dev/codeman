import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { PodRegistry } from "../inference/registry.ts";
import { Ledger } from "../ledger.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { seedRuns } from "../testing/ledger-runs.ts";
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

test("Firestore emulator: two runs that reserve at once near the monthly budget", {
  skip,
}, async () => {
  const store = Firestore.emulator(host, project());
  await seedRuns(store, {
    "250-1-9": { status: "closed", cost: 16.5 },
    "300-1-7": {},
    "300-1-8": {},
  });
  const runtime = new FakeRuntime({ runId: "300" });
  const reserve = (task: number) =>
    new Ledger(store, { runtime, job: "open-key" }).reserve(`300-1-${task}`, {
      task,
      taskBudget: 2,
      monthlyBudget: 20,
      recorded: 0,
      billed: new Map(),
    });
  const outcomes = await Promise.all([reserve(7), reserve(8)]);
  assert.deepEqual(outcomes.map((one) => one.outcome).sort(), ["over-budget", "reserved"]);
  const open = await store.query("organizations/o/runs", {
    where: [{ field: "status", op: "==", value: "open" }],
  });
  assert.equal(open.length, 1);
});

test("Firestore emulator: tasks that claim a pod's settings at once get one creator", {
  skip,
}, async () => {
  const registry = new PodRegistry(Firestore.emulator(host, project()), "o");
  const description = {
    settings: "0123456789abcdef",
    model: "qwen3-coder:30b",
    gpuType: "GPU-A",
    image: "ghcr.io/o/codeman-pod@sha256:1",
    reuse: "task",
    provider: "runpod",
  };
  const claims = await Promise.all(
    ["o/r#7", "o/s#7"].map((holder) => registry.claim(description, holder, "300")),
  );
  assert.deepEqual(claims.map((claim) => claim.kind).sort(), ["create", "wait"]);
  assert.equal((await registry.live()).length, 1);
});

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
