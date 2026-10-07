import assert from "node:assert/strict";
import { test } from "node:test";
import { type Fields, type Store, StoreConflict, type Transaction } from "./store.ts";

/**
 * What every store must do, as tests: `memory.test.ts` runs them on the store in memory, and
 * `emulator.test.ts` on Firestore's emulator, so the memory store stands for Firestore in the
 * other tests. `make` gives an empty store for each test; `skip` says why they cannot run.
 */
export function storeContract(
  name: string,
  make: () => Store | Promise<Store>,
  options: { skip?: string | false } = {},
): void {
  const it = (title: string, body: (store: Store) => Promise<void>) =>
    test(`${name}: ${title}`, { skip: options.skip || false }, async () => body(await make()));

  it("reads back each kind of value it wrote, and nothing where nothing was written", async (store) => {
    const fields: Fields = {
      none: null,
      yes: true,
      count: 3,
      negative: -12,
      cost: 0.0312,
      text: "codeman/o/r",
      at: new Date("2026-10-07T12:34:56.789Z"),
      list: [1, "a", false, { nested: 2.5 }],
      map: { inner: { deep: ["x"] }, empty: {} },
      emptyList: [],
    };
    await store.write([{ op: "create", path: "things/one", fields }]);
    const found = await store.get("things/one");
    assert.deepEqual(found?.fields, fields);
    assert.equal(found?.path, "things/one");
    assert.equal(await store.get("things/two"), undefined);
    assert.equal(await store.get("other/one"), undefined);
  });

  it("creates only what does not exist, and sets or merges what may", async (store) => {
    await store.write([{ op: "create", path: "runs/a", fields: { cost: 1, limit: 2 } }]);
    await assert.rejects(
      store.write([{ op: "create", path: "runs/a", fields: { cost: 9 } }]),
      StoreConflict,
    );
    await store.write([{ op: "set", path: "runs/a", fields: { cost: 1.5, merge: false } }]);
    assert.deepEqual((await store.get("runs/a"))?.fields, { cost: 1.5, merge: false });
    await store.write([{ op: "set", path: "runs/a", fields: { limit: 3 }, merge: true }]);
    assert.deepEqual((await store.get("runs/a"))?.fields, { cost: 1.5, merge: false, limit: 3 });
    // Merging replaces a map whole, at the top level.
    await store.write([
      { op: "set", path: "runs/b", fields: { map: { a: 1, b: 2 } }, merge: true },
    ]);
    await store.write([{ op: "set", path: "runs/b", fields: { map: { c: 3 } }, merge: true }]);
    assert.deepEqual((await store.get("runs/b"))?.fields, { map: { c: 3 } });
    await store.write([{ op: "delete", path: "runs/b" }]);
    assert.equal(await store.get("runs/b"), undefined);
    await store.write([{ op: "delete", path: "runs/b" }]);
  });

  it("holds writes to their preconditions, and keeps the version of a write that changes nothing", async (store) => {
    await store.write([{ op: "create", path: "leases/pod", fields: { holder: "a" } }]);
    const first = await store.get("leases/pod");
    assert.ok(first);
    await store.write([{ op: "set", path: "leases/pod", fields: { holder: "a" } }]);
    assert.equal((await store.get("leases/pod"))?.version, first.version);
    await store.write([
      { op: "set", path: "leases/pod", fields: { holder: "b" }, if: { version: first.version } },
    ]);
    const second = await store.get("leases/pod");
    assert.notEqual(second?.version, first.version);
    await assert.rejects(
      store.write([
        { op: "set", path: "leases/pod", fields: { holder: "c" }, if: { version: first.version } },
      ]),
      StoreConflict,
    );
    await assert.rejects(
      store.write([
        { op: "set", path: "leases/gone", fields: {}, merge: true, if: { exists: true } },
      ]),
      StoreConflict,
    );
    await assert.rejects(
      store.write([{ op: "delete", path: "leases/gone", if: { exists: true } }]),
      StoreConflict,
    );
    await assert.rejects(
      store.write([{ op: "set", path: "leases/pod", fields: {}, if: { exists: false } }]),
      StoreConflict,
    );
    assert.deepEqual((await store.get("leases/pod"))?.fields, { holder: "b" });
  });

  it("applies a write whole or not at all", async (store) => {
    await store.write([{ op: "create", path: "runs/taken", fields: {} }]);
    await assert.rejects(
      store.write([
        { op: "create", path: "runs/new", fields: { n: 1 } },
        { op: "create", path: "runs/taken", fields: { n: 2 } },
      ]),
      StoreConflict,
    );
    assert.equal(await store.get("runs/new"), undefined);
    assert.deepEqual((await store.get("runs/taken"))?.fields, {});
  });

  it("queries a collection's own documents by their fields, in order", async (store) => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    await store.write([
      {
        op: "create",
        path: "orgs/o/runs/1",
        fields: { repo: "a", month: "2026-10", cost: 1, at: at(1) },
      },
      {
        op: "create",
        path: "orgs/o/runs/2",
        fields: { repo: "b", month: "2026-10", cost: 2.5, at: at(2) },
      },
      { op: "create", path: "orgs/o/runs/3", fields: { repo: "a", month: "2026-09", cost: 0.25 } },
      { op: "create", path: "orgs/o/runs/4", fields: { repo: "a", month: "2026-10" } },
      // Neither a subcollection's documents nor another organization's are the collection's.
      { op: "create", path: "orgs/o/runs/1/parts/1", fields: { repo: "a", month: "2026-10" } },
      { op: "create", path: "orgs/p/runs/1", fields: { repo: "a", month: "2026-10", cost: 1 } },
    ]);
    const paths = (found: { path: string }[]) => found.map((document) => document.path);
    assert.deepEqual(paths(await store.query("orgs/o/runs")), [
      "orgs/o/runs/1",
      "orgs/o/runs/2",
      "orgs/o/runs/3",
      "orgs/o/runs/4",
    ]);
    assert.deepEqual(
      paths(
        await store.query("orgs/o/runs", {
          where: [
            { field: "repo", op: "==", value: "a" },
            { field: "month", op: "==", value: "2026-10" },
          ],
        }),
      ),
      ["orgs/o/runs/1", "orgs/o/runs/4"],
    );
    assert.deepEqual(
      paths(
        await store.query("orgs/o/runs", {
          where: [{ field: "cost", op: ">=", value: 1 }],
          orderBy: [{ field: "cost", direction: "desc" }],
        }),
      ),
      ["orgs/o/runs/2", "orgs/o/runs/1"],
    );
    assert.deepEqual(
      paths(await store.query("orgs/o/runs", { where: [{ field: "at", op: ">", value: at(1) }] })),
      ["orgs/o/runs/2"],
    );
    // Documents without the field to order by are left out.
    assert.deepEqual(
      paths(await store.query("orgs/o/runs", { orderBy: [{ field: "cost" }], limit: 2 })),
      ["orgs/o/runs/3", "orgs/o/runs/1"],
    );
    assert.deepEqual(await store.query("orgs/q/runs"), []);
  });

  it("commits a transaction's writes with what it read, and returns its result", async (store) => {
    const result = await store.transaction(async (tx) => {
      const counter = await tx.get("counters/runs");
      const [other] = await tx.query("counters");
      tx.write({ op: "create", path: "counters/runs", fields: { n: 1 } });
      return { counter, other };
    });
    assert.deepEqual(result, { counter: undefined, other: undefined });
    assert.deepEqual((await store.get("counters/runs"))?.fields, { n: 1 });
  });

  it("writes nothing of a transaction that fails", async (store) => {
    await assert.rejects(
      store.transaction(async (tx) => {
        await tx.get("counters/runs");
        tx.write({ op: "create", path: "counters/runs", fields: { n: 1 } });
        throw new Error("changed my mind");
      }),
      /changed my mind/,
    );
    assert.equal(await store.get("counters/runs"), undefined);
  });

  it("runs again a transaction whose read document another one changed", async (store) => {
    await store.write([{ op: "create", path: "counters/runs", fields: { n: 0 } }]);
    const both = barrier(2);
    let attempts = 0;
    const increment = () =>
      store.transaction(async (tx) => {
        attempts++;
        const n = Number((await tx.get("counters/runs"))?.fields.n);
        await both.first();
        tx.write({ op: "set", path: "counters/runs", fields: { n: n + 1 } });
      });
    await Promise.all([increment(), increment()]);
    assert.deepEqual((await store.get("counters/runs"))?.fields, { n: 2 });
    assert.ok(attempts >= 3, `${attempts} attempts`);
  });

  it("runs again a transaction whose query another one changed", async (store) => {
    const both = barrier(2);
    const reserve = (id: string) =>
      store.transaction(async (tx: Transaction) => {
        const month = await tx.query("reservations", {
          where: [{ field: "month", op: "==", value: "2026-10" }],
        });
        await both.first();
        tx.write({ op: "create", path: `reservations/${id}`, fields: { month: "2026-10" } });
        return month.length;
      });
    const seen = await Promise.all([reserve("a"), reserve("b")]);
    assert.deepEqual(seen.sort(), [0, 1], "the second saw the first's reservation");
  });
}

/** Holds each caller's first attempt until `count` of them arrive, then lets all through. */
function barrier(count: number): { first: () => Promise<void> } {
  let waiting = 0;
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let used = 0;
  return {
    first: async () => {
      if (used++ >= count) return;
      waiting++;
      if (waiting === count) open();
      await opened;
    },
  };
}
