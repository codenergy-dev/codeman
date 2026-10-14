import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Offer } from "./batches.ts";
import {
  BOARD_TTL_MS,
  boardEntry,
  exchange,
  handshake,
  type OwnTask,
  RESERVATION_TTL_MS,
  readBatch,
} from "./board.ts";
import type { RepositoryRef } from "./platform/types.ts";
import { select } from "./steps/select.ts";
import { LAYOUT } from "./store/layout.ts";
import { MemoryStore } from "./store/memory.ts";
import type { Store } from "./store/store.ts";
import { FakePlatform, fakeServices } from "./testing/fake-platform.ts";
import { FakeRuntime } from "./testing/fake-runtime.ts";

const workdir = mkdtempSync(join(tmpdir(), "codeman-board-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

const four: Offer = { tasks: 4, profile: "four", key: "k4", pod: true };
const T0 = new Date("2026-10-13T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const pool = { id: "a+b", members: ["a", "b"] };

function own(numbers: number[], offers: Offer[] = [four]): OwnTask[] {
  return numbers.map((number) => ({ number, stage: "code", offers }));
}

/** An exchange of `repository`'s `select` with these ready tasks, at `now`. */
function run(
  store: Store,
  repository: string,
  tasks: OwnTask[],
  now: Date,
  options: { runId?: string; places?: number; members?: string[] } = {},
) {
  return exchange(store, {
    pool: { id: pool.id, members: options.members ?? pool.members },
    repository,
    run: { id: options.runId ?? String(now.getTime() / 60_000), attempt: 1 },
    now,
    own: tasks,
    places: options.places ?? 4,
  });
}

async function listed(store: Store, repository: string): Promise<number[]> {
  const document = await store.get(LAYOUT.boardEntry(pool.id, repository));
  const entry = document && boardEntry(document);
  return entry ? entry.tasks.map((task) => task.number) : [];
}

test("each select rewrites its repository's snapshot whole, and keeps when a task was first listed", async () => {
  const store = new MemoryStore();
  await run(store, "a/x", own([1, 2]), at(0));
  assert.deepEqual(await listed(store, "a/x"), [1, 2]);
  // #1 closed: the next snapshot drops it; #2 keeps its `since`; #3 is new.
  await run(store, "a/x", own([2, 3]), at(10));
  assert.deepEqual(await listed(store, "a/x"), [2, 3]);
  const document = await store.get(LAYOUT.boardEntry(pool.id, "a/x"));
  const entry = document && boardEntry(document);
  assert.deepEqual(
    entry?.tasks.map((task) => task.since.toISOString()),
    [at(0).toISOString(), at(10).toISOString()],
  );
  assert.equal(entry?.expiresAt.getTime(), at(10).getTime() + BOARD_TTL_MS);
  // Tasks no pod serves are not on the board.
  await run(store, "a/x", own([4], [{ ...four, pod: false }]), at(11));
  assert.deepEqual(await listed(store, "a/x"), []);
});

test("2 and 2 across two repositories form a batch of 4; the other repository's run honors it", async () => {
  const store = new MemoryStore();
  const first = await run(store, "a/x", own([1, 2]), at(0));
  assert.deepEqual(
    first.waiting.map((one) => [one.number, one.ready, one.repositories]),
    [
      [1, 2, 1],
      [2, 2, 1],
    ],
  );
  const formed = await run(store, "b/y", own([7, 8]), at(5), { runId: "200" });
  assert.deepEqual(
    formed.formed.map((task) => [task.number, task.size, task.batch]),
    [
      [7, 4, "200-1-0"],
      [8, 4, "200-1-0"],
    ],
  );
  assert.deepEqual(formed.dispatches, [{ owner: "a", repository: "x", batches: "200-1-0" }]);
  const batch = await readBatch(store, pool.id, "200-1-0");
  assert.deepEqual(
    batch?.members.map((member) => [member.repository, member.number, member.status]),
    [
      ["a/x", 1, "reserved"],
      ["a/x", 2, "reserved"],
      ["b/y", 7, "started"],
      ["b/y", 8, "started"],
    ],
  );
  assert.equal(batch?.expiresAt.getTime(), at(5).getTime() + RESERVATION_TTL_MS);
  assert.deepEqual(await listed(store, "b/y"), [], "the tasks it starts leave the board");

  // Whichever run of a/x comes first honors the reservation, not only the dispatched one.
  const honored = await run(store, "a/x", own([1, 2, 3]), at(10), { runId: "300" });
  assert.deepEqual(
    honored.honored.map((task) => [task.number, task.size, task.batch]),
    [
      [1, 4, "200-1-0"],
      [2, 4, "200-1-0"],
    ],
  );
  assert.deepEqual(await listed(store, "a/x"), [3]);
  const after = await readBatch(store, pool.id, "200-1-0");
  assert.ok(after?.members.every((member) => member.status === "started"));
  // A later run finds nothing reserved any more.
  assert.deepEqual((await run(store, "a/x", own([3]), at(12))).honored, []);
});

test("a reserved task no longer ready is dropped and released; an expired reservation returns its tasks", async () => {
  const store = new MemoryStore();
  await run(store, "a/x", own([1, 2]), at(0));
  await run(store, "b/y", own([7, 8]), at(1), { runId: "200" });
  // #1 was closed meanwhile: a/x's next select does not read it from GitHub.
  const next = await run(store, "a/x", own([2]), at(2));
  assert.deepEqual(next.dropped, [{ number: 1, batch: "200-1-0" }]);
  assert.deepEqual(
    next.honored.map((task) => task.number),
    [2],
  );
  const batch = await readBatch(store, pool.id, "200-1-0");
  assert.deepEqual(
    batch?.members.map((member) => member.status),
    ["dropped", "started", "started", "started"],
  );

  // Another pair, reserved but never honored within 30 minutes, returns to the board.
  await run(store, "a/x", own([3, 4]), at(40));
  const formed = await run(store, "b/y", own([9, 10]), at(41), { runId: "201" });
  assert.equal(formed.dispatches.length, 1);
  const c = await run(store, "c/z", own([], []), at(42), { members: ["a", "b", "c"] });
  assert.deepEqual(c.batches, [], "reserved tasks are not offered again");
  const later = await run(store, "b/y", own([11, 12]), at(41 + 31), { runId: "202" });
  assert.deepEqual(
    later.batches[0]?.tasks.map((task) => `${task.repository}#${task.number}`),
    ["a/x#3", "a/x#4", "b/y#11", "b/y#12"],
  );
});

test("a snapshot from before dispatches took the default branch still reads, and names no workflow", async () => {
  const store = new MemoryStore();
  await run(store, "a/x", own([1, 2]), at(0));
  const path = LAYOUT.boardEntry(pool.id, "a/x");
  const written = await store.get(path);
  assert.ok(written);
  // Older snapshots also held the branch and the workflow, which a member's run could choose.
  await store.write([
    {
      op: "set",
      path,
      fields: { ...written.fields, branch: "--ref=x", workflow: "release.yml" },
    },
  ]);
  const formed = await run(store, "b/y", own([7, 8]), at(5), { runId: "200" });
  assert.deepEqual(formed.dispatches, [{ owner: "a", repository: "x", batches: "200-1-0" }]);
});

test("a snapshot expires, and a repository outside the pool is never batched nor dispatched", async () => {
  const store = new MemoryStore();
  // An entry written under the pool by an owner that is not a member.
  await run(store, "c/z", own([5, 6]), at(0), { members: ["a", "b", "c"] });
  const formed = await run(store, "b/y", own([7, 8]), at(1));
  assert.deepEqual(formed.batches, []);
  assert.deepEqual(formed.dispatches, []);
  // A member's snapshot older than its time is not read.
  await run(store, "a/x", own([1, 2]), at(2));
  const late = await run(store, "b/y", own([7, 8]), new Date(at(2).getTime() + BOARD_TTL_MS + 1));
  assert.deepEqual(late.batches, []);
});

test("two selects at once reserve each task once", async () => {
  const store = new MemoryStore();
  await run(store, "a/x", own([1, 2, 3, 4]), at(0), { places: 0 });
  const [one, two] = await Promise.all([
    run(store, "b/y", [], at(1), { runId: "500" }),
    run(store, "b/z", [], at(1), { runId: "600" }),
  ]);
  assert.equal(one.batches.length + two.batches.length, 1);
});

test("an organization batches only with members that declare the same pool", async () => {
  const store = new MemoryStore();
  const both = { id: "a+b", members: ["a", "b"] };
  let agreed = await handshake(store, "A", both, at(0));
  assert.deepEqual(agreed.pool, { id: "a+b", members: ["a"] });
  assert.deepEqual(agreed.notes, [
    "Organization b has declared no pool yet (none of its repositories ran this version of Codeman): its repositories are not batched with this one's.",
  ]);
  assert.deepEqual((await store.get(LAYOUT.organization("a")))?.fields, {
    pool: "a+b",
    members: ["a", "b"],
    declaredAt: at(0),
  });
  // b declares itself alone.
  await handshake(store, "b", { id: "b", members: ["b"] }, at(1));
  agreed = await handshake(store, "a", both, at(2));
  assert.deepEqual(agreed.notes, [
    "Organization b declares pool `b`, not `a+b`: its repositories are not batched with this one's.",
  ]);
  // Its declaration does not change: the document keeps its time.
  assert.deepEqual((await store.get(LAYOUT.organization("a")))?.fields.declaredAt, at(0));
  await handshake(store, "b", both, at(3));
  agreed = await handshake(store, "a", both, at(4));
  assert.deepEqual(agreed, { pool: both, notes: [] });
});

const SETTINGS = [
  "profiles:",
  "  - name: planner",
  "    stages: [plan]",
  "    model: a/b",
  "  - name: four",
  "    stages: [route, web, design, code, test, review]",
  "    tasks: 4",
  "    provider: runpod-pod",
  '    gpu: "GPU A"',
  "    model: qwen3-coder:30b",
].join("\n");

function repository(repository: RepositoryRef, count: number): FakePlatform {
  const platform = new FakePlatform({ ".codeman/settings.yml": SETTINGS }, repository);
  platform.maintainers.add("alice");
  for (let index = 0; index < count; index++) {
    platform.openIssue("alice", `Task ${index + 1}`, "Do it.", ["codeman", "codeman:ready"]);
  }
  return platform;
}

async function selectIn(
  platform: FakePlatform,
  store: Store,
  runId: string,
  settings = "pool: [org-a, org-b]",
) {
  const runtime = new FakeRuntime({
    inputs: { workdir, settings },
    runId,
    repository: platform.repository,
  });
  await select(fakeServices(platform, runtime, undefined, undefined, undefined, store));
  return runtime;
}

function picked(runtime: FakeRuntime): [string, string, string | undefined][] {
  const tasks = JSON.parse(runtime.outputs.tasks ?? "[]") as Record<string, string>[];
  return tasks.map((task) => {
    const choice = JSON.parse(task.inference ?? "{}");
    return [task.task ?? "", choice.profile, choice.batch];
  });
}

test("select: tasks of two organizations of a pool form a batch, which the other's run starts", async () => {
  const store = new MemoryStore();
  const a = repository({ owner: "org-a", name: "x" }, 2);
  const b = repository({ owner: "org-b", name: "y" }, 2);
  // org-b has not run yet: org-a's tasks wait alone, and the log says why.
  const first = await selectIn(a, store, "100");
  assert.equal(first.outputs.action, "none");
  assert.equal(first.outputs.dispatches, "[]");
  assert.ok(first.logged("warning").some((line) => line.startsWith("Organization org-b has")));
  assert.match(
    a.botComments(1)[0] ?? "",
    /Waiting for 4 tasks ready for profile `four`; 2 are, in 1 repository\./,
  );
  // org-b's run forms the batch: its 2 tasks start, and it wakes org-a's repository.
  const second = await selectIn(b, store, "200");
  assert.deepEqual(picked(second), [
    ["1", "four", "200-1-0"],
    ["2", "four", "200-1-0"],
  ]);
  assert.deepEqual(JSON.parse(second.outputs.dispatches ?? ""), [
    { owner: "org-a", repository: "x", batches: "200-1-0" },
  ]);
  const choice = JSON.parse(JSON.parse(second.outputs.tasks ?? "")[0].inference);
  assert.deepEqual(choice.pool, { id: "org-a+org-b", members: ["org-a", "org-b"] });
  // org-a's next run, dispatched or not, starts its reserved tasks with the batch's count.
  const third = await selectIn(a, store, "101");
  assert.deepEqual(picked(third), [
    ["1", "four", "200-1-0"],
    ["2", "four", "200-1-0"],
  ]);
  assert.ok(
    third
      .logged("info")
      .includes(
        "#1 was reserved by batch 200-1-0, of 4 task(s) for profile `four`; it starts now.",
      ),
  );
});

test("select: a reserved task closed before its repository's run is dropped and released", async () => {
  const store = new MemoryStore();
  const a = repository({ owner: "org-a", name: "x" }, 2);
  const b = repository({ owner: "org-a", name: "y" }, 2);
  await selectIn(a, store, "100", "");
  const formed = await selectIn(b, store, "200", "");
  assert.equal(JSON.parse(formed.outputs.dispatches ?? "").length, 1);
  a.issues.get(1)?.labels.splice(0, 1);
  const next = await selectIn(a, store, "101", "");
  assert.deepEqual(picked(next), [["2", "four", "200-1-0"]]);
  assert.ok(
    next
      .logged("info")
      .includes("#1 was reserved by batch 200-1-0, but is no longer ready for it; released."),
  );
  const batch = await readBatch(store, "org-a", "200-1-0");
  assert.deepEqual(
    batch?.members.map((member) => member.status),
    ["dropped", "started", "started", "started"],
  );
});

test("select: a `pool` without the organization stops the run before any task", async () => {
  const a = repository({ owner: "org-a", name: "x" }, 1);
  await assert.rejects(
    selectIn(a, new MemoryStore(), "1", "pool: [org-b]"),
    /must include the organization itself, `org-a`/,
  );
  assert.deepEqual(a.botComments(1), []);
});
