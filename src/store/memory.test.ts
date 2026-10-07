import assert from "node:assert/strict";
import { test } from "node:test";
import { storeContract } from "./contract.ts";
import { MemoryStore } from "./memory.ts";
import { StoreConflict } from "./store.ts";

storeContract("memory", () => new MemoryStore());

test("memory: a transaction that keeps conflicting gives up after its attempts", async () => {
  const store = new MemoryStore();
  await store.write([{ op: "create", path: "counters/runs", fields: { n: 0 } }]);
  let attempts = 0;
  await assert.rejects(
    store.transaction(
      async (tx) => {
        attempts++;
        await tx.get("counters/runs");
        // Another writer changes what this transaction read, every time.
        await store.write([{ op: "set", path: "counters/runs", fields: { n: attempts } }]);
      },
      { attempts: 3 },
    ),
    StoreConflict,
  );
  assert.equal(attempts, 3);
});

test("memory: paths must name a document or a collection", async () => {
  const store = new MemoryStore();
  await assert.rejects(store.get("runs"), /"runs" is not a document path/);
  await assert.rejects(store.query("runs/a"), /"runs\/a" is not a collection path/);
  await assert.rejects(store.get("runs//a"), /not a document path/);
  await assert.rejects(
    store.write([{ op: "create", path: "runs/a", fields: { n: Number.NaN } }]),
    /NaN is not a finite number/,
  );
  await assert.rejects(
    store.write([{ op: "create", path: "runs/a", fields: { list: [[1]] } }]),
    /an array may not hold an array/,
  );
});
