import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "../budget.ts";
import { Runpod } from "./runpod.ts";

function near(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-12, `${actual} ≉ ${expected}`);
}

function fakeFetch(responses: (unknown | Response)[]): {
  fetch: Fetch;
  calls: [string, RequestInit][];
} {
  const calls: [string, RequestInit][] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const body = responses.shift();
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as Fetch;
  return { fetch: fetchFn, calls };
}

const pod = {
  id: "abc123",
  name: "codeman-r-7-300",
  status: "PROVISIONING",
  image: "ghcr.io/x/pod@sha256:1",
  env: { CODEMAN_ORGANIZATION: "o", CODEMAN_POD_SETTINGS: "s" },
  gpu: { id: "NVIDIA RTX A6000", count: 1 },
  cost: 0.72,
  createdAt: "2026-10-03T12:00:00Z",
};

test("creates a pod on Secure Cloud with one GPU and one HTTP port", async () => {
  const { fetch, calls } = fakeFetch([pod]);
  const created = await new Runpod("rk", fetch).pods.create({
    name: "codeman-r-7-300",
    image: "ghcr.io/x/pod@sha256:1",
    env: { CODEMAN_POD_SETTINGS: "s" },
    port: 8080,
    gpuType: "NVIDIA RTX A6000",
    diskGb: 60,
  });
  const [url, init] = calls[0] ?? [];
  assert.equal(url, "https://api.runpod.io/v2/pods");
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer rk");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    name: "codeman-r-7-300",
    image: "ghcr.io/x/pod@sha256:1",
    gpu: { id: "NVIDIA RTX A6000", count: 1 },
    cloud: "SECURE",
    env: { CODEMAN_POD_SETTINGS: "s" },
    ports: ["8080/http"],
    disk: 60,
  });
  assert.equal(created.status, "starting");
  assert.equal(created.gpuType, "NVIDIA RTX A6000");
  near(created.pricePerSecond, 0.0002);
  assert.deepEqual(created.createdAt, new Date("2026-10-03T12:00:00Z"));
});

test("reads a pod's status, and a missing pod as none", async () => {
  const { fetch, calls } = fakeFetch([
    { ...pod, status: "RUNNING" },
    new Response('{"title":"Not Found","status":404}', { status: 404 }),
  ]);
  const runpod = new Runpod("rk", fetch);
  assert.equal((await runpod.pods.get("abc123"))?.status, "running");
  assert.equal(await runpod.pods.get("gone"), undefined);
  assert.equal(calls[1]?.[0], "https://api.runpod.io/v2/pods/gone");
});

test("lists the account's pods across pages, keeping those with the given environment", async () => {
  const other = { ...pod, id: "other", env: { CODEMAN_ORGANIZATION: "x" } };
  const { fetch, calls } = fakeFetch([
    { pods: [pod, other], pagination: { nextCursor: "c2", hasNextPage: true } },
    {
      pods: [{ ...pod, id: "p2", env: null }],
      pagination: { nextCursor: null, hasNextPage: false },
    },
  ]);
  const pods = await new Runpod("rk", fetch).pods.list({ CODEMAN_ORGANIZATION: "o" });
  assert.deepEqual(
    pods.map((found) => found.id),
    ["abc123"],
  );
  assert.deepEqual(
    calls.map(([url]) => url),
    ["https://api.runpod.io/v2/pods", "https://api.runpod.io/v2/pods?cursor=c2"],
  );
});

test("lists every pod of the account for an empty environment", async () => {
  const { fetch } = fakeFetch([
    { pods: [pod, { ...pod, id: "p2", env: null }], pagination: { hasNextPage: false } },
  ]);
  const pods = await new Runpod("rk", fetch).pods.list({});
  assert.deepEqual(
    pods.map((found) => found.id),
    ["abc123", "p2"],
  );
});

test("terminates a pod, and a pod already gone is not an error", async () => {
  const { fetch, calls } = fakeFetch([
    new Response(null, { status: 204 }),
    new Response("{}", { status: 404 }),
  ]);
  const runpod = new Runpod("rk", fetch);
  await runpod.pods.terminate("abc123");
  await runpod.pods.terminate("gone");
  assert.equal(calls[0]?.[1].method, "DELETE");
  assert.equal(calls[0]?.[0], "https://api.runpod.io/v2/pods/abc123");
});

test("reaches a pod's port through Runpod's proxy", () => {
  assert.equal(new Runpod("rk").pods.url("abc123", 8080), "https://abc123-8080.proxy.runpod.net");
});

test("adds up the billing of the given pods since the day they started", async () => {
  const { fetch, calls } = fakeFetch([
    {
      records: [
        { podId: "a", totalAmount: 0.1 },
        { podId: "b", totalAmount: 0.5 },
        { podId: "a", totalAmount: 0.05 },
        { podId: "z", totalAmount: 9 },
      ],
    },
  ]);
  const billed = await new Runpod("rk", fetch, () => new Date("2026-10-05T12:00:00Z")).pods.billing(
    ["a", "b", "c"],
    new Date("2026-10-03T15:30:00Z"),
  );
  assert.deepEqual(Object.keys(billed), ["a", "b"]);
  near(billed.a, 0.15);
  near(billed.b, 0.5);
  assert.equal(
    calls[0]?.[0],
    "https://api.runpod.io/v2/billing/pods?bucketSize=day&startTime=2026-10-03T00%3A00%3A00Z&endTime=2026-10-06T00%3A00%3A00Z",
  );
  assert.deepEqual(await new Runpod("rk", fetch).pods.billing([], new Date()), {});
});

test("reads the whole account's billing by the hour", async () => {
  const { fetch, calls } = fakeFetch([
    {
      records: [
        { startTime: "2026-10-03T13:00:00Z", totalAmount: 0.25 },
        { startTime: "2026-10-03T14:00:00Z", totalAmount: 1.5 },
        { startTime: "2026-10-03T15:00:00Z" },
        { startTime: "2026-09-30T23:00:00Z", totalAmount: 9 },
      ],
    },
  ]);
  const hours = await new Runpod("rk", fetch).billedHours(
    new Date("2026-10-01T00:00:00Z"),
    new Date("2026-10-03T15:30:00Z"),
  );
  assert.deepEqual(
    [...hours].map(([hour, amount]) => [new Date(hour).toISOString(), amount]),
    [
      ["2026-10-03T13:00:00.000Z", 0.25],
      ["2026-10-03T14:00:00.000Z", 1.5],
      ["2026-10-03T15:00:00.000Z", 0],
    ],
    "an hour before the window is left out",
  );
  assert.equal(
    calls[0]?.[0],
    "https://api.runpod.io/v2/billing?bucketSize=hour&startTime=2026-10-01T00%3A00%3A00Z&endTime=2026-10-03T16%3A00%3A00Z",
  );
});

test("prices a GPU type on Secure Cloud per second, and refuses one it does not offer", async () => {
  const { fetch, calls } = fakeFetch([
    { id: "NVIDIA RTX A6000", secure: true, price: { secure: 0.36, community: 0.25 } },
    { id: "X", secure: false, price: { secure: 0, community: 0.2 } },
  ]);
  const runpod = new Runpod("rk", fetch);
  near(await runpod.pods.price("NVIDIA RTX A6000"), 0.0001);
  assert.equal(calls[0]?.[0], "https://api.runpod.io/v2/catalog/gpus/NVIDIA%20RTX%20A6000");
  await assert.rejects(runpod.pods.price("X"), /does not offer X on Secure Cloud/);
  const { fetch: missing } = fakeFetch([new Response("{}", { status: 404 })]);
  await assert.rejects(
    new Runpod("rk", missing).pods.price("PRO 6000 MIG 48GB"),
    /no GPU type "PRO 6000 MIG 48GB"\. `gpu` takes the GPU's ID/,
  );
});

test("reads a Serverless endpoint's workers, and prices its dearest GPU type", async () => {
  const endpoint = {
    id: "ep1",
    type: "QUEUE",
    gpu: { pools: ["ADA_24", "AMPERE_48"], excludedTypes: ["NVIDIA L40S"], count: 2 },
    workers: { min: 0, max: 1, idleTimeout: 5 },
    env: { MODEL_NAME: "org/model" },
  };
  const { fetch } = fakeFetch([
    endpoint,
    endpoint,
    {
      gpus: [
        { id: "NVIDIA GeForce RTX 4090", pool: "ADA_24", price: { serverless: 1.116 } },
        { id: "NVIDIA RTX A6000", pool: "AMPERE_48", price: { serverless: 1.224 } },
        { id: "NVIDIA L40S", pool: "AMPERE_48", price: { serverless: 9 } },
        { id: "NVIDIA H100", pool: "HOPPER_80", price: { serverless: 9 } },
      ],
    },
  ]);
  const runpod = new Runpod("rk", fetch);
  assert.deepEqual(await runpod.serverless.endpoint("ep1"), {
    id: "ep1",
    type: "QUEUE",
    workersMin: 0,
    workersMax: 1,
    idleTimeoutSeconds: 5,
    gpuCount: 2,
    env: { MODEL_NAME: "org/model" },
  });
  near(await runpod.serverless.price("ep1"), 0.00068);
  assert.equal(runpod.serverless.queueUrl("ep1"), "https://api.runpod.ai/v2/ep1");
});

test("reports what a failure's problem says, and nothing of another body", async () => {
  const { fetch } = fakeFetch([
    new Response(
      JSON.stringify({
        title: "Bad Request",
        status: 400,
        detail: "invalid query",
        errors: ["bucketSize: must be one of hour, day"],
      }),
      { status: 400 },
    ),
    new Response("<html>gateway error</html>", { status: 502 }),
  ]);
  const runpod = new Runpod("rk", fetch);
  await assert.rejects(runpod.billedHours(new Date("2026-10-01"), new Date("2026-10-05")), {
    message:
      "Runpod GET /billing failed with 400: Bad Request — invalid query — bucketSize: must be one of hour, day",
  });
  await assert.rejects(runpod.pods.get("x"), { message: "Runpod GET /pods/x failed with 502." });
});
