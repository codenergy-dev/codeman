import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "../budget.ts";
import { Firestore } from "./firestore.ts";
import { StoreConflict } from "./store.ts";

const DB = "projects/codeman-ops/databases/(default)";
const API = `https://firestore.googleapis.com/v1/${DB}/documents`;

function fakeFetch(responses: (unknown | Response)[]): {
  fetch: Fetch;
  calls: { url: string; init: RequestInit; body: Record<string, unknown> }[];
} {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next ?? {}), { status: 200 });
  }) as Fetch;
  return { fetch: fetchFn, calls };
}

const error = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code: status, message, status: code } }), { status });

function store(fetchFn: Fetch, waits: number[] = []): Firestore {
  return new Firestore({
    project: "codeman-ops",
    token: async () => "access-token",
    fetch: fetchFn,
    wait: async (ms) => {
      waits.push(ms);
    },
  });
}

test("writes each kind of write and value in Firestore's terms, with the token", async () => {
  const { fetch, calls } = fakeFetch([{ writeResults: [] }]);
  await store(fetch).write([
    {
      op: "create",
      path: "organizations/o/runs/1-1-7",
      fields: {
        task: 7,
        cost: 0.25,
        at: new Date("2026-10-07T12:00:00.000Z"),
        none: null,
        open: true,
        pods: ["a"],
        usage: { tokens: 10 },
      },
    },
    { op: "set", path: "organizations/o/runs/2", fields: { cost: 1 }, merge: true },
    {
      op: "set",
      path: "organizations/o/runs/3",
      fields: {},
      if: { version: "2026-10-07T12:00:00Z" },
    },
    { op: "delete", path: "organizations/o/runs/4", if: { exists: true } },
    { op: "set", path: "organizations/o/runs/5", fields: { "odd name": 1 }, merge: true },
  ]);
  const [call] = calls;
  assert.equal(call?.url, `${API}:commit`);
  assert.equal(new Headers(call?.init.headers).get("authorization"), "Bearer access-token");
  assert.deepEqual(call?.body, {
    writes: [
      {
        update: {
          name: `${DB}/documents/organizations/o/runs/1-1-7`,
          fields: {
            task: { integerValue: "7" },
            cost: { doubleValue: 0.25 },
            at: { timestampValue: "2026-10-07T12:00:00.000Z" },
            none: { nullValue: null },
            open: { booleanValue: true },
            pods: { arrayValue: { values: [{ stringValue: "a" }] } },
            usage: { mapValue: { fields: { tokens: { integerValue: "10" } } } },
          },
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `${DB}/documents/organizations/o/runs/2`,
          fields: { cost: { integerValue: "1" } },
        },
        updateMask: { fieldPaths: ["cost"] },
      },
      {
        update: { name: `${DB}/documents/organizations/o/runs/3`, fields: {} },
        currentDocument: { updateTime: "2026-10-07T12:00:00Z" },
      },
      { delete: `${DB}/documents/organizations/o/runs/4`, currentDocument: { exists: true } },
      {
        update: {
          name: `${DB}/documents/organizations/o/runs/5`,
          fields: { "odd name": { integerValue: "1" } },
        },
        updateMask: { fieldPaths: ["`odd name`"] },
      },
    ],
  });
});

test("reads a document by batchGet, and a missing one as none", async () => {
  const { fetch, calls } = fakeFetch([
    [
      {
        found: {
          name: `${DB}/documents/organizations/o/runs/1`,
          fields: {
            cost: { doubleValue: "NaN" },
            limit: { doubleValue: 1.75 },
            at: { timestampValue: "2026-10-07T12:00:00.123456Z" },
          },
          updateTime: "2026-10-07T12:00:01.000001Z",
        },
        readTime: "2026-10-07T12:00:02Z",
      },
    ],
    [{ missing: `${DB}/documents/organizations/o/runs/2`, readTime: "2026-10-07T12:00:02Z" }],
  ]);
  const firestore = store(fetch);
  const found = await firestore.get("organizations/o/runs/1");
  assert.equal(found?.path, "organizations/o/runs/1");
  assert.equal(found?.version, "2026-10-07T12:00:01.000001Z");
  assert.ok(Number.isNaN(found?.fields.cost));
  assert.equal(found?.fields.limit, 1.75);
  assert.deepEqual(found?.fields.at, new Date("2026-10-07T12:00:00.123Z"));
  assert.equal(await firestore.get("organizations/o/runs/2"), undefined);
  assert.equal(calls[0]?.url, `${API}:batchGet`);
  assert.deepEqual(calls[0]?.body, { documents: [`${DB}/documents/organizations/o/runs/1`] });
});

test("queries a collection under its parent, with filters, order and limit", async () => {
  const { fetch, calls } = fakeFetch([
    [
      {
        document: {
          name: `${DB}/documents/organizations/o.x/runs/1`,
          fields: { repository: { stringValue: "r" } },
          updateTime: "2026-10-07T12:00:00Z",
        },
      },
      { readTime: "2026-10-07T12:00:00Z" },
    ],
  ]);
  const found = await store(fetch).query("organizations/o.x/runs", {
    where: [
      { field: "repository", op: "==", value: "r" },
      { field: "month", op: "==", value: "2026-10" },
    ],
    orderBy: [{ field: "openedAt", direction: "desc" }],
    limit: 10,
  });
  assert.deepEqual(found, [
    {
      path: "organizations/o.x/runs/1",
      fields: { repository: "r" },
      version: "2026-10-07T12:00:00Z",
    },
  ]);
  assert.equal(calls[0]?.url, `${API}/organizations/o.x:runQuery`);
  assert.deepEqual(calls[0]?.body, {
    structuredQuery: {
      from: [{ collectionId: "runs" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "repository" },
                op: "EQUAL",
                value: { stringValue: "r" },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "month" },
                op: "EQUAL",
                value: { stringValue: "2026-10" },
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: "openedAt" }, direction: "DESCENDING" }],
      limit: 10,
    },
  });
});

test("a precondition that fails is a conflict; any other error says what Firestore said", async () => {
  const { fetch } = fakeFetch([
    error(409, "ALREADY_EXISTS", "Document already exists: .../runs/1"),
    error(400, "FAILED_PRECONDITION", "the stored version does not match"),
    error(403, "PERMISSION_DENIED", "Missing or insufficient permissions."),
  ]);
  const firestore = store(fetch);
  const create = [{ op: "create" as const, path: "runs/1", fields: {} }];
  await assert.rejects(firestore.write(create), StoreConflict);
  await assert.rejects(firestore.write(create), /400 FAILED_PRECONDITION/);
  await assert.rejects(
    firestore.write(create),
    (thrown: Error) =>
      !(thrown instanceof StoreConflict) &&
      thrown.message ===
        "Firestore commit failed with 403 PERMISSION_DENIED: Missing or insufficient permissions.",
  );
});

test("a transaction that Firestore aborts runs again, naming the one before it", async () => {
  const waits: number[] = [];
  const doc = (n: number) => [
    {
      found: {
        name: `${DB}/documents/counters/runs`,
        fields: { n: { integerValue: String(n) } },
        updateTime: `2026-10-07T12:00:0${n}Z`,
      },
    },
  ];
  const { fetch, calls } = fakeFetch([
    { transaction: "tx1" },
    doc(1),
    error(409, "ABORTED", "Transaction lock timeout."),
    { transaction: "tx2" },
    doc(2),
    { writeResults: [{}] },
  ]);
  let runs = 0;
  const result = await store(fetch, waits).transaction(async (tx) => {
    runs++;
    const n = Number((await tx.get("counters/runs"))?.fields.n);
    tx.write({ op: "set", path: "counters/runs", fields: { n: n + 1 } });
    return n + 1;
  });
  assert.equal(result, 3);
  assert.equal(runs, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(
    calls.map((call) => call.url.slice(API.length)),
    [":beginTransaction", ":batchGet", ":commit", ":beginTransaction", ":batchGet", ":commit"],
  );
  assert.deepEqual(calls[0]?.body, { options: { readWrite: {} } });
  assert.deepEqual(calls[1]?.body, {
    documents: [`${DB}/documents/counters/runs`],
    transaction: "tx1",
  });
  assert.deepEqual(calls[3]?.body, { options: { readWrite: { retryTransaction: "tx1" } } });
  assert.equal(calls[5]?.body.transaction, "tx2");
});

test("a transaction gives up after its attempts, and rolls back when its work fails", async () => {
  const aborted = () => error(409, "ABORTED", "Too much contention.");
  const { fetch, calls } = fakeFetch([
    { transaction: "tx1" },
    aborted(),
    { transaction: "tx2" },
    aborted(),
    { transaction: "tx3" },
    {},
  ]);
  const firestore = store(fetch);
  await assert.rejects(
    firestore.transaction(async () => undefined, { attempts: 2 }),
    (thrown: Error) =>
      thrown instanceof StoreConflict && /2 times: .*Too much contention/.test(thrown.message),
  );
  await assert.rejects(
    firestore.transaction(async () => {
      throw new Error("work failed");
    }),
    /work failed/,
  );
  assert.equal(calls.at(-1)?.url, `${API}:rollback`);
  assert.deepEqual(calls.at(-1)?.body, { transaction: "tx3" });
});

test("the emulator is reached over HTTP on its host, without a token", async () => {
  const { fetch, calls } = fakeFetch([[{ missing: "x" }]]);
  await Firestore.emulator("127.0.0.1:8080", "demo-codeman", fetch).get("runs/1");
  assert.equal(
    calls[0]?.url,
    "http://127.0.0.1:8080/v1/projects/demo-codeman/databases/(default)/documents:batchGet",
  );
  assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), null);
  assert.throws(() => Firestore.emulator("h", "Not A Project"), /not a Google Cloud project ID/);
});
