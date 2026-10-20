import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { exchange } from "../board.ts";
import { PodRegistry } from "../inference/registry.ts";
import { Ledger } from "../ledger.ts";
import { emulatorJar, startEmulator } from "../testing/emulator.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { closeOnEndpoint, minutes, NOON, seedRuns, serverlessRun } from "../testing/ledger-runs.ts";
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
  host = await start(jar);
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

test("Firestore emulator: two Serverless runs that close at once split the time they shared", {
  skip,
}, async () => {
  const store = Firestore.emulator(host, project());
  await seedRuns(
    store,
    {
      "300-1-7": serverlessRun("codeman", NOON - 60_000),
      "310-1-4": serverlessRun("other", NOON + 4 * 60_000),
    },
    "codenergy",
    new Date(NOON),
  );
  await Promise.all([
    closeOnEndpoint(store, "300-1-7", "codeman", [minutes(0, 10)], NOON + 16 * 60_000),
    closeOnEndpoint(store, "310-1-4", "other", [minutes(5, 15)], NOON + 16 * 60_000),
  ]);
  // Whichever split ran last saw both runs' times.
  for (const run of ["300-1-7", "310-1-4"]) {
    assert.equal((await store.get(`organizations/codenergy/runs/${run}`))?.fields.cost, 0.45);
  }
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

test("Firestore emulator: two selects at once reserve each task of the board once", {
  skip,
}, async () => {
  const store = Firestore.emulator(host, project());
  const offers = [{ tasks: 4, profile: "four", key: "k4", pod: true }];
  const now = new Date();
  const run = (repository: string, id: string, tasks: number[], places: number) =>
    exchange(store, {
      pool: { id: "o", members: ["o"] },
      repository,
      run: { id, attempt: 1 },
      now,
      own: tasks.map((number) => ({ number, stage: "code", offers })),
      places,
    });
  await run("o/a", "100", [1, 2, 3, 4], 0);
  const formed = await Promise.all([run("o/b", "200", [], 4), run("o/c", "300", [], 4)]);
  assert.equal(formed[0].batches.length + formed[1].batches.length, 1);
});

const rulesSkip = jar
  ? false
  : "loading the rules needs the emulator in Firebase's cache, and Java";
test("Firestore emulator: the security rules deny every client", { skip: rulesSkip }, async () => {
  if (!jar) return;
  const ruled = await start(jar, ["--rules", RULES]);
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

async function start(path: string, args: readonly string[] = []): Promise<string> {
  const emulator = await startEmulator(path, args);
  started.push(emulator.process);
  return emulator.host;
}
