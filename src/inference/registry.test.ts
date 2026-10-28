import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "../store/memory.ts";
import { type Claim, CREATE_LEASE_MS, type PodDescription, PodRegistry } from "./registry.ts";

const description: PodDescription = {
  settings: "0123456789abcdef",
  model: "qwen3-coder:30b",
  gpuType: "GPU-A",
  image: "ghcr.io/o/codeman-pod@sha256:1",
  reuse: "task",
  provider: "runpod",
};
const HOUR = 3_600_000;
/** A run lease as long as a reservation of two hours. */
const LEASE = 2 * HOUR;

function setup() {
  const store = new MemoryStore();
  let now = new Date("2026-10-07T12:00:00Z");
  const registry = new PodRegistry(store, "O", () => now);
  return {
    store,
    registry,
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

/** Claims, and registers the pod when the claim creates it. */
async function created(registry: PodRegistry, holder: string, pod = "pod1") {
  const claim = await registry.claim(description, holder, "300", LEASE);
  assert.equal(claim.kind, "create");
  const registered = await registry.register(claim.pod.nonce, {
    pod,
    createdAt: new Date("2026-10-07T12:00:00Z"),
    pricePerSecond: 0.0002,
  });
  assert.ok(registered);
  return registered;
}

test("tasks that claim at once get one creator; the others wait, then join with seats of their own", async () => {
  const { store, registry } = setup();
  const claims = await Promise.all(
    ["o/r#7", "o/r#8", "o/s#7"].map((holder) => registry.claim(description, holder, "300", LEASE)),
  );
  const creators = claims.filter((claim) => claim.kind === "create");
  assert.equal(creators.length, 1);
  assert.equal(claims.filter((claim) => claim.kind === "wait").length, 2);
  const [creator] = creators as Extract<Claim, { kind: "create" }>[];
  assert.ok(creator);
  const document = await store.get(`pools/o/pods/${creator.pod.nonce}`);
  assert.equal(document?.fields.status, "creating");
  assert.equal(document?.fields.live, true);
  assert.equal(document?.fields.model, "qwen3-coder:30b");
  assert.equal(document?.fields.settings, description.settings);

  await registry.register(creator.pod.nonce, {
    pod: "pod1",
    createdAt: new Date(),
    pricePerSecond: 0.0002,
  });
  const waiting = ["o/r#7", "o/r#8", "o/s#7"].filter((holder) => holder !== creator.pod.seats[0]);
  const joins = [];
  for (const holder of waiting) joins.push(await registry.claim(description, holder, "300", LEASE));
  assert.deepEqual(
    joins.map((claim) => [claim.kind, claim.kind === "wait" ? 0 : claim.seat, claim.pod.pod]),
    [
      ["join", 2, "pod1"],
      ["join", 3, "pod1"],
    ],
  );
  const [pod] = await registry.live();
  assert.equal(pod?.status, "serving");
  assert.deepEqual(pod?.leases.map((lease) => [lease.holder, lease.kind]).sort(), [
    ["o/r#7", "run"],
    ["o/r#8", "run"],
    ["o/s#7", "run"],
  ]);
  assert.equal(pod?.leases[0]?.until.getTime(), new Date("2026-10-07T14:00:00Z").getTime());
});

test("a creator that dies leaves a lease that expires, and the next task creates the pod", async () => {
  const { registry, advance } = setup();
  const first = await registry.claim(description, "o/r#7", "300", LEASE);
  assert.equal(first.kind, "create");
  advance(CREATE_LEASE_MS - 1);
  assert.equal((await registry.claim(description, "o/r#8", "300", LEASE)).kind, "wait");
  advance(1);
  const second = await registry.claim(description, "o/r#8", "300", LEASE);
  assert.equal(second.kind, "create");
  assert.notEqual(second.pod.nonce, first.pod.nonce);
  // The first creator's pod came too late: the registry does not take it.
  assert.equal(
    await registry.register(first.pod.nonce, {
      pod: "pod1",
      createdAt: new Date(),
      pricePerSecond: 0.0002,
    }),
    undefined,
  );
  const live = await registry.live();
  assert.deepEqual(
    live.map((pod) => pod.nonce),
    [second.pod.nonce],
  );
});

test("a task of another repository joins the pod with its own seat, and keeps it after its run", async () => {
  const { registry, now } = setup();
  await created(registry, "o/r#7");
  const other = await registry.claim(description, "o/s#7", "900", LEASE);
  assert.equal(other.kind, "join");
  assert.equal(other.kind === "join" && other.seat, 2);

  const kept = await registry.leave(other.pod.nonce, "o/s#7", {
    keepUntil: new Date(now().getTime() + 15 * 60_000),
  });
  assert.equal(kept.ended, false);
  assert.deepEqual(kept.holders.sort(), ["o/r#7", "o/s#7"]);
  assert.deepEqual(
    kept.pod?.leases.map((lease) => [lease.holder, lease.kind, lease.run]),
    [
      ["o/r#7", "run", "300"],
      ["o/s#7", "keep", "900"],
    ],
  );
  // Its next run on the pod keeps its seat.
  const again = await registry.claim(description, "o/s#7", "901", LEASE);
  assert.equal(again.kind === "join" && again.seat, 2);
});

test("the last task to leave ends the pod; a release ends only a keep lease", async () => {
  const { registry, now, advance } = setup();
  const pod = await created(registry, "o/r#7");
  await registry.claim(description, "o/r#8", "300", LEASE);
  const keepUntil = new Date(now().getTime() + 15 * 60_000);
  assert.equal((await registry.leave(pod.nonce, "o/r#7", { keepUntil })).ended, false);
  // Task 8's run is still open: a release does not end it.
  const released = await registry.leave(pod.nonce, "o/r#8", { onlyKeep: true });
  assert.equal(released.ended, false);
  assert.deepEqual(released.holders.sort(), ["o/r#7", "o/r#8"]);
  assert.equal((await registry.leave(pod.nonce, "o/r#8")).ended, false, "task 7 keeps it");
  const last = await registry.leave(pod.nonce, "o/r#7", { onlyKeep: true });
  assert.equal(last.ended, true);
  assert.equal(last.pod?.status, "ended");
  assert.deepEqual(await registry.live(), []);
  // A pod no longer live is left as it is.
  advance(1_000);
  const after = await registry.leave(pod.nonce, "o/r#7");
  assert.deepEqual([after.ended, after.holders], [false, []]);
});

test("a pod whose other leases all expired ends with the task that leaves it", async () => {
  const { registry, advance } = setup();
  const pod = await created(registry, "o/r#7");
  advance(HOUR);
  await registry.claim(description, "o/r#8", "301", LEASE);
  advance(HOUR);
  // Task 7's run lease expired an hour after task 8 joined.
  const left = await registry.leave(pod.nonce, "o/r#8");
  assert.equal(left.ended, true);
});

test("an abandoned pod takes no new task, and the next claim creates another", async () => {
  const { registry } = setup();
  const pod = await created(registry, "o/r#7");
  const joined = await registry.claim(description, "o/r#8", "300", LEASE);
  assert.equal(joined.kind, "join");
  const left = await registry.leave(pod.nonce, "o/r#8", { abandon: true });
  assert.equal(left.ended, false, "task 7's run still holds it");
  assert.equal(left.pod?.status, "abandoned");
  const next = await registry.claim(description, "o/r#8", "300", LEASE);
  assert.equal(next.kind, "create");
  assert.equal((await registry.live()).length, 2);
});

test("pods of other settings or organizations are apart", async () => {
  const { store, registry } = setup();
  await created(registry, "o/r#7");
  const other = await registry.claim(
    { ...description, settings: "fedcba9876543210" },
    "o/r#8",
    "1",
    LEASE,
  );
  assert.equal(other.kind, "create");
  const elsewhere = new PodRegistry(store, "x");
  assert.equal((await elsewhere.claim(description, "x/r#7", "1", LEASE)).kind, "create");
});

test("a pod takes runs up to its capacity, its batch's reserved tasks included; then another is created", async () => {
  const { store, registry } = setup();
  // A batch of 2 of o/r and 2 of o/s, whose first task creates the pod.
  await store.write([
    {
      op: "create",
      path: "pools/o/batches/300-1-0",
      fields: {
        key: "k",
        size: 4,
        formedAt: new Date("2026-10-07T12:00:00Z"),
        expiresAt: new Date("2026-10-07T12:30:00Z"),
        members: [
          { repository: "o/r", number: 1, status: "started" },
          { repository: "o/r", number: 2, status: "started" },
          { repository: "o/s", number: 3, status: "reserved" },
          { repository: "o/s", number: 4, status: "dropped" },
        ],
      },
    },
  ]);
  const sized = { ...description, account: "acc", capacity: 3, batch: "300-1-0" };
  const first = await registry.claim(sized, "o/r#1", "300", LEASE);
  assert.equal(first.kind, "create");
  await registry.register(first.pod.nonce, {
    pod: "pod1",
    createdAt: new Date("2026-10-07T12:00:00Z"),
    pricePerSecond: 0.0002,
  });
  // A task of no batch finds it full: #1 runs, #2 and #3 are reserved (#4 was dropped).
  const outsider = { ...description, account: "acc", capacity: 3 };
  const other = await registry.claim(outsider, "o/t#9", "301", LEASE);
  assert.equal(other.kind, "create", "it creates another pod");
  // The batch's own tasks always join their pod.
  for (const holder of ["o/r#2", "o/s#3"]) {
    const join = await registry.claim(sized, holder, "302", LEASE);
    assert.equal(join.kind === "join" && join.pod.nonce, first.pod.nonce, holder);
  }
  // A pod of another account is never joined.
  const elsewhere = await registry.claim({ ...sized, account: "other" }, "o/r#5", "303", LEASE);
  assert.equal(elsewhere.kind, "create");
  assert.deepEqual(
    (await registry.live("acc")).map((pod) => pod.nonce).sort(),
    [first.pod.nonce, other.pod.nonce].sort(),
  );
});

test("a pod with room takes a task of no batch, and its document records what sizes it", async () => {
  const { store, registry } = setup();
  const sized = { ...description, account: "acc", capacity: 2 };
  const first = await registry.claim(sized, "o/r#1", "300", LEASE);
  await registry.register(first.pod.nonce, {
    pod: "pod1",
    createdAt: new Date("2026-10-07T12:00:00Z"),
    pricePerSecond: 0.0002,
  });
  const fields = (await store.get(`pools/o/pods/${first.pod.nonce}`))?.fields;
  assert.deepEqual([fields?.account, fields?.capacity, fields?.batch], ["acc", 2, undefined]);
  assert.equal((await registry.claim(sized, "o/s#2", "301", LEASE)).kind, "join");
  assert.equal((await registry.claim(sized, "o/t#3", "302", LEASE)).kind, "create", "full at 2");
});
