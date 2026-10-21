import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { MemoryLauncher } from "./memory-launcher.ts";
import { RunpodFake } from "./runpod.ts";
import { openAiBackend } from "./serverless.ts";

const KEY = "rpa_e2e";
const START = Date.parse("2026-10-20T12:00:00Z");
let now = START;
const launcher = new MemoryLauncher();
const runpod = new RunpodFake(
  {
    keys: [KEY],
    endpoints: [
      { id: "ep1", workers: { min: 0, max: 1, idleTimeout: 5 }, gpu: { pools: ["AMPERE_48"] } },
    ],
  },
  { launcher, now: () => now },
);
let origin = "";
before(async () => {
  origin = await runpod.server.listen();
});
after(async () => {
  await launcher.close();
  await runpod.server.close();
});
beforeEach(async () => {
  runpod.server.reset();
  await launcher.close();
  launcher.launched.length = 0;
  launcher.terminated.length = 0;
  launcher.hold = false;
  launcher.failure = undefined;
  now = START;
});

async function call(method: string, path: string, body?: unknown, key = KEY) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

const POD = {
  name: "codeman-acme-abc",
  image: "ghcr.io/codenergy-dev/codeman-pod@sha256:1234",
  gpu: { id: "NVIDIA RTX A6000", count: 1 },
  cloud: "SECURE",
  env: {
    CODEMAN_NONCE: "n1",
    CODEMAN_OLLAMA: '{"OLLAMA_NUM_PARALLEL":"2"}',
    CODEMAN_START_BY: "2026-10-20T12:25:00.000Z",
  },
  ports: ["8000/http"],
  disk: 40,
};

/** Waits until the pod's status is `status`, as Codeman polls it. */
async function until(id: string, status: string): Promise<Record<string, unknown>> {
  for (let tries = 0; tries < 100; tries++) {
    const { body } = await call("GET", `/v2/pods/${id}`);
    if (body?.status === status) return body;
    await sleep(5);
  }
  throw new Error(`Pod ${id} never reached ${status}.`);
}

test("a created pod's env reaches the launcher unchanged, with its image, GPU and ports", async () => {
  const created = await call("POST", "/v2/pods", POD);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "PROVISIONING");
  assert.equal(created.body.cost, 0.49);
  assert.deepEqual(created.body.env, POD.env);
  const running = await until(created.body.id, "RUNNING");
  assert.equal(running.cudaVersion, "13.0");
  assert.equal(launcher.launched.length, 1);
  const [spec] = launcher.launched;
  assert.deepEqual(spec?.env, POD.env);
  assert.equal(spec?.id, created.body.id);
  assert.equal(spec?.image, POD.image);
  assert.deepEqual(spec?.gpu, { id: "NVIDIA RTX A6000", count: 1, memoryGb: 48 });
  assert.deepEqual(spec?.ports, [{ port: 8000, protocol: "http" }]);
  assert.equal(spec?.diskGb, 40);

  // Through the proxy, the pod's own server answers with the environment it got.
  const env = await fetch(`${origin}/pods/${created.body.id}/8000/env`);
  assert.deepEqual(await env.json(), POD.env);
  const echo = await fetch(`${origin}/pods/${created.body.id}/8000/admin/run?x=1`, {
    method: "POST",
    body: "{}",
  });
  assert.deepEqual(await echo.json(), { method: "POST", url: "/admin/run?x=1", body: "{}" });
  // A port the pod does not expose, or an unknown pod, is a 404.
  assert.equal((await fetch(`${origin}/pods/${created.body.id}/9000/health`)).status, 404);
  assert.equal((await fetch(`${origin}/pods/nope/8000/health`)).status, 404);
});

test("a terminated pod stops billing, and leaves the API but not its billing", async () => {
  const { body: pod } = await call("POST", "/v2/pods", POD);
  await until(pod.id, "RUNNING");
  assert.equal((await call("GET", "/_fake/runpod/pods")).body[0].billing, "running");
  now += 3600_000;
  const terminated = await call("DELETE", `/v2/pods/${pod.id}`);
  assert.equal(terminated.status, 204);
  assert.deepEqual(launcher.terminated, [pod.id]);
  assert.equal((await call("GET", `/v2/pods/${pod.id}`)).status, 404);
  assert.equal((await call("DELETE", `/v2/pods/${pod.id}`)).status, 404);
  assert.deepEqual((await call("GET", "/v2/pods")).body.pods, []);
  now += 5 * 3600_000;

  const query = "bucketSize=day&startTime=2026-10-20T00:00:00Z&endTime=2026-10-21T00:00:00Z";
  const billing = await call("GET", `/v2/billing/pods?${query}`);
  assert.equal(billing.body.records.length, 1);
  assert.equal(billing.body.records[0].podId, pod.id);
  assert.ok(Math.abs(billing.body.records[0].totalAmount - 0.49) < 1e-9);
  const [listed] = (await call("GET", "/_fake/runpod/pods")).body;
  assert.equal(listed.status, "TERMINATED");
  assert.equal(listed.billing, "stopped");
  assert.ok(Math.abs(listed.cost - 0.49) < 1e-9);

  const hours = await call(
    "GET",
    "/v2/billing?bucketSize=hour&startTime=2026-10-20T12:00:00Z&endTime=2026-10-20T15:00:00Z",
  );
  assert.equal(hours.body.records.length, 1);
  assert.equal(hours.body.records[0].startTime, "2026-10-20T12:00:00Z");
  assert.equal((await call("GET", "/v2/billing?startTime=2026-10-20T12:00:00Z")).status, 400);
});

test("pods are listed newest first, by pages, and exited pods cost nothing", async () => {
  const first = (await call("POST", "/v2/pods", POD)).body;
  now += 1000;
  const second = (await call("POST", "/v2/pods", { ...POD, name: "two" })).body;
  await until(second.id, "RUNNING");
  const one = await call("GET", "/v2/pods?limit=1");
  assert.deepEqual(
    one.body.pods.map((pod: { id: string }) => pod.id),
    [second.id],
  );
  assert.equal(one.body.pagination.hasNextPage, true);
  const next = await call(
    "GET",
    `/v2/pods?limit=1&cursor=${encodeURIComponent(one.body.pagination.nextCursor)}`,
  );
  assert.deepEqual(
    next.body.pods.map((pod: { id: string }) => pod.id),
    [first.id],
  );
  assert.deepEqual(next.body.pagination, { nextCursor: null, hasNextPage: false });

  assert.equal((await call("POST", `/_fake/runpod/pods/${second.id}/exit`)).status, 204);
  const exited = (await call("GET", `/v2/pods/${second.id}`)).body;
  assert.equal(exited.status, "EXITED");
  assert.equal(exited.cost, 0);
});

test("creation fails on capacity, contract and faults, as Runpod answers", async () => {
  const offline = await call("PATCH", "/_fake/runpod/catalog/NVIDIA%20RTX%20A6000", {
    availability: "NONE",
  });
  assert.equal(offline.status, 200);
  const full = await call("POST", "/v2/pods", POD);
  assert.equal(full.status, 400);
  assert.match(full.body.detail, /no longer any instances available/);

  await call("PATCH", "/_fake/runpod/catalog/NVIDIA%20RTX%20A6000", {
    availability: "HIGH",
    cudaVersions: [{ version: "12.8", available: true }],
  });
  const old = await call("POST", "/v2/pods", {
    ...POD,
    gpu: { ...POD.gpu, minCudaVersion: "13.0" },
  });
  assert.equal(old.status, 400);

  const invalid = await call("POST", "/v2/pods", { ...POD, env: { A: 1 }, ports: ["8000"] });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.errors, [
    "$.env.A: expected string",
    "$.ports[0]: expected port/protocol",
  ]);
  assert.equal((await call("POST", "/v2/pods", POD, "wrong")).status, 401);
  assert.equal((await call("GET", "/v2/pods", undefined, "")).body.detail, "missing bearer token");

  await call("POST", "/_fake/faults", { method: "POST", path: "/v2/pods", status: 500, times: 1 });
  assert.equal((await call("POST", "/v2/pods", POD)).status, 500);
  assert.equal((await call("POST", "/v2/pods", POD)).status, 201);
  assert.equal(launcher.launched.length, 1);
});

test("no capacity is a 400 and a low balance a 402, as problems (docs/web/runpod/)", async () => {
  await call("PATCH", "/_fake/runpod/catalog/NVIDIA%20RTX%20A6000", { availability: "NONE" });
  const full = await fetch(`${origin}/v2/pods`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(POD),
  });
  assert.equal(full.status, 400);
  assert.equal(full.headers.get("content-type"), "application/problem+json");
  const problem = (await full.json()) as { title: string; status: number; detail: unknown };
  assert.equal(problem.title, "Bad Request");
  assert.equal(problem.status, 400);
  assert.equal(typeof problem.detail, "string");

  await call("PATCH", "/_fake/runpod/catalog/NVIDIA%20RTX%20A6000", { availability: "HIGH" });
  assert.equal((await call("PUT", "/_fake/runpod/faults", { lowBalance: true })).status, 204);
  const poor = await call("POST", "/v2/pods", POD);
  assert.equal(poor.status, 402);
  assert.deepEqual(poor.body, {
    title: "Payment Required",
    status: 402,
    detail: "Insufficient balance.",
  });
  // The contract comes first: a body that breaks it is a 422 whatever the balance.
  assert.equal((await call("POST", "/v2/pods", { ...POD, ports: ["8000"] })).status, 422);
  assert.equal(launcher.launched.length, 0);
  assert.equal((await call("PUT", "/_fake/runpod/faults", { lowBalance: "yes" })).status, 400);
  assert.equal((await call("PUT", "/_fake/runpod/faults", { balance: "low" })).status, 400);
  await call("PUT", "/_fake/runpod/faults", {});
  assert.equal((await call("POST", "/v2/pods", POD)).status, 201);
});

test("a pod may never start, fail to start, or restart its container", async () => {
  await call("PUT", "/_fake/runpod/faults", { podStart: "never" });
  const stuck = (await call("POST", "/v2/pods", POD)).body;
  await until(stuck.id, "STARTING");
  await sleep(20);
  assert.equal((await call("GET", `/v2/pods/${stuck.id}`)).body.status, "STARTING");
  assert.equal(launcher.launched.length, 0);

  await call("PUT", "/_fake/runpod/faults", {});
  launcher.failure = "image not in the allowlist";
  const failed = (await call("POST", "/v2/pods", POD)).body;
  await until(failed.id, "ERROR");
  const [, listed] = (await call("GET", "/_fake/runpod/pods")).body;
  assert.equal(listed.failure, "image not in the allowlist");

  launcher.failure = undefined;
  launcher.hold = true;
  const pod = (await call("POST", "/v2/pods", POD)).body;
  assert.equal((await call("GET", `/v2/pods/${pod.id}`)).body.status, "STARTING");
  assert.equal((await fetch(`${origin}/pods/${pod.id}/8000/health`)).status, 404);
  launcher.release();
  await until(pod.id, "RUNNING");
  launcher.hold = false;
  assert.equal((await call("POST", `/_fake/runpod/pods/${pod.id}/restart`)).status, 204);
  await until(pod.id, "RUNNING");
  const restarted = (await call("GET", "/_fake/runpod/pods")).body.find(
    (one: { id: string }) => one.id === pod.id,
  );
  assert.equal(restarted.launches, 2);
  assert.deepEqual(launcher.launched.at(-1)?.env, POD.env);
  assert.equal((await fetch(`${origin}/pods/${pod.id}/8000/health`)).status, 200);

  // The shared faults give the proxy's 404 for a pod that runs.
  await call("POST", "/_fake/faults", { path: `/pods/${pod.id}/8000/{rest*}`, status: 404 });
  assert.equal((await fetch(`${origin}/pods/${pod.id}/8000/health`)).status, 404);
});

test("the catalog answers prices, memory, CUDA versions and availability", async () => {
  const { body } = await call("GET", "/v2/catalog/gpus");
  assert.equal(body.gpus.length, 2);
  assert.equal(body.gpus[0].availability, undefined);
  const gpu = await call(
    "GET",
    "/v2/catalog/gpus/NVIDIA%20RTX%20A6000?include=AVAILABILITY&product=POD&cloud=SECURE&minCudaVersion=13.0",
  );
  assert.equal(gpu.body.memory, 48);
  assert.equal(gpu.body.price.secure, 0.49);
  assert.equal(gpu.body.availability, "HIGH");
  assert.deepEqual(gpu.body.cudaVersions, [{ version: "13.0", available: true }]);
  assert.equal((await call("GET", "/v2/catalog/gpus?include=AVAILABILITY")).status, 400);
  assert.equal((await call("GET", "/v2/catalog/gpus/nope")).status, 404);
  const none = await call(
    "GET",
    "/v2/catalog/gpus/NVIDIA%20RTX%20A6000?include=AVAILABILITY&product=POD&minCudaVersion=14.0",
  );
  assert.equal(none.body.availability, "NONE");
  assert.equal(none.body.cudaVersions, undefined);
});

test("a Serverless job runs, reports its status and gives its output", async () => {
  const endpoint = await call("GET", "/v2/serverless/ep1");
  assert.equal(endpoint.body.type, "QUEUE");
  assert.deepEqual(endpoint.body.workers, { min: 0, max: 1, idleTimeout: 5 });
  assert.equal((await call("GET", "/v2/serverless")).body.endpoints[0].id, "ep1");
  assert.equal((await call("GET", "/v2/serverless/nope")).status, 404);

  const run = await call("POST", "/v2/ep1/run", { input: { prompt: "hi" } });
  assert.equal(run.body.status, "IN_QUEUE");
  let status = await call("GET", `/v2/ep1/status/${run.body.id}`);
  for (let tries = 0; status.body.status !== "COMPLETED" && tries < 50; tries++) {
    await sleep(5);
    status = await call("GET", `/v2/ep1/status/${run.body.id}`);
  }
  assert.equal(status.body.status, "COMPLETED");
  assert.deepEqual(status.body.output, { echo: { prompt: "hi" } });

  // A held queue keeps the job waiting, until the hold goes; the health reports both.
  await call("PUT", "/_fake/runpod/faults", { holdQueues: ["ep1"] });
  const queued = await call("POST", "/v2/ep1/run", {
    input: {
      openai_route: "/v1/chat/completions",
      openai_input: {
        model: "m",
        stream: true,
        messages: [{ role: "user", content: "two words" }],
      },
    },
  });
  const health = await call("GET", "/v2/ep1/health");
  assert.equal(health.body.jobs.inQueue, 1);
  assert.equal(health.body.jobs.completed, 1);
  assert.equal(health.body.workers.running, 1, "the idle timeout keeps the worker running");
  assert.equal((await call("GET", `/v2/ep1/stream/${queued.body.id}`)).body.status, "IN_QUEUE");
  await call("PUT", "/_fake/runpod/faults", {});
  await sleep(10);
  const page = await call("GET", `/v2/ep1/stream/${queued.body.id}`);
  assert.equal(page.body.status, "COMPLETED");
  assert.equal(page.body.stream.length, 3);
  assert.match(page.body.stream[0].output, /^data: .*"content":"echo: two words"/);
  assert.equal(page.body.stream[2].output, "data: [DONE]\n\n");
  assert.deepEqual((await call("GET", `/v2/ep1/stream/${queued.body.id}`)).body.stream, []);

  now += 60_000;
  const idle = (await call("GET", "/v2/ep1/health")).body.workers;
  assert.deepEqual(idle, {
    idle: 1,
    initializing: 0,
    ready: 0,
    running: 0,
    throttled: 0,
    unhealthy: 0,
  });
  await call("PUT", "/_fake/runpod/endpoints/ep1/workers", { initializing: 1 });
  assert.equal((await call("GET", "/v2/ep1/health")).body.workers.initializing, 1);
  assert.equal((await call("GET", "/v2/ep1/health", undefined, "")).status, 401);
});

test("a job is cancelled in the queue, and its worker's time is billed", async () => {
  await call("PUT", "/_fake/runpod/faults", { holdQueues: true });
  const job = (await call("POST", "/v2/ep1/run", { input: {} })).body;
  const cancelled = await call("POST", `/v2/ep1/cancel/${job.id}`);
  assert.deepEqual(cancelled.body, { id: job.id, status: "CANCELLED" });
  await call("PUT", "/_fake/runpod/faults", {});
  assert.equal((await call("GET", `/v2/ep1/status/${job.id}`)).body.status, "CANCELLED");
  assert.equal((await call("GET", "/v2/ep1/status/nope")).status, 404);

  // Set workers bill by the second at the endpoint's dearest pool price.
  await call("PUT", "/_fake/runpod/endpoints/ep1/workers", { running: 1 });
  now += 3600_000;
  await call("DELETE", "/_fake/runpod/endpoints/ep1/workers");
  now += 3600_000;
  const spent = (await call("GET", "/_fake/runpod/endpoints/ep1/cost")).body;
  assert.equal(spent.pricePerHour, 1.22);
  assert.ok(Math.abs(spent.cost - 1.22) < 1e-9);
});

test("the OpenAI worker forwards a job and gives each event of its stream as an output", async () => {
  const upstream = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    request.on("end", () => {
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(JSON.parse(body).model, "m");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"a":1}\n\ndata: {"b":2}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const { port } = upstream.address() as AddressInfo;
  const outputs: unknown[] = [];
  for await (const output of openAiBackend(`http://127.0.0.1:${port}`).run(
    {
      id: "j",
      endpoint: "ep1",
      env: {},
      input: { openai_route: "/v1/chat/completions", openai_input: { model: "m", stream: true } },
    },
    new AbortController().signal,
  )) {
    outputs.push(output);
  }
  upstream.close();
  assert.deepEqual(outputs, ['data: {"a":1}\n\n', 'data: {"b":2}\n\n', "data: [DONE]\n\n"]);
});
