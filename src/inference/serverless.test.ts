import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { FakeGpu } from "../testing/fake-gpu.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { agentAccess } from "./access.ts";
import type { Endpoint } from "./gpu.ts";
import {
  MAX_USAGE_CHARS,
  type ServerlessHandle,
  ServerlessInference,
  type ServerlessSettings,
  usageReport,
} from "./selfhosted.ts";
import { vllm, vllmContextLength, vllmProblems } from "./vllm.ts";

const settings: ServerlessSettings = {
  model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  engine: vllm,
  pods: [],
  endpoint: "ep1",
  engineProblems: vllmProblems,
  contextLength: vllmContextLength,
};
const endpoint: Endpoint = {
  id: "ep1",
  type: "QUEUE",
  workersMin: 0,
  workersMax: 1,
  idleTimeoutSeconds: 5,
  gpuCount: 1,
  env: {
    MODEL_NAME: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    MAX_MODEL_LEN: "65536",
    ENABLE_AUTO_TOOL_CHOICE: "true",
    TOOL_CALL_PARSER: "qwen3_coder",
  },
};

function provider(changes: Partial<Endpoint> = {}, usage = "") {
  const gpu = new FakeGpu();
  gpu.endpoints.set("ep1", { ...endpoint, ...changes });
  return new ServerlessInference(settings, gpu, { usage });
}

test("a run checks the endpoint and prices its workers; the agent gets only a token", async () => {
  const serverless = provider();
  const opened = await serverless.open({ task: "7", runId: "300", limit: 1.6 }, new FakeRuntime());
  const handle = JSON.parse(opened.handle) as ServerlessHandle;
  assert.deepEqual(handle, {
    mode: "serverless",
    endpoint: "ep1",
    url: "https://serverless.test/ep1",
    pricePerSecond: 0.0003,
    idleSeconds: 5,
    limit: 1.6,
    contextLength: 65536,
  });
  assert.equal(opened.baseUrl, undefined, "the agent job's gateway gives the URL");
  assert.match(opened.credential, /^[\w-]{43}$/);
});

test("refuses an endpoint that breaks Codeman's rules or does not serve the model", async () => {
  await assert.rejects(
    provider({ workersMin: 1 }).open({ task: "7", runId: "1", limit: 1 }, new FakeRuntime()),
    /endpoint ep1 cannot serve this run: it keeps 1 active worker/,
  );
  await assert.rejects(
    provider({ env: { ...endpoint.env, MODEL_NAME: "other/model" } }).open(
      { task: "7", runId: "1", limit: 1 },
      new FakeRuntime(),
    ),
    /it serves `other\/model`/,
  );
});

test("close costs the run from what the agent job's gateway measured", async () => {
  const usage = JSON.stringify({
    requests: 4,
    inputTokens: 9000,
    outputTokens: 300,
    maxInputTokens: 4000,
    tokensPerSecond: 41.5,
    cost: 0.12,
    start: 1,
    end: 2,
  });
  const handle = JSON.stringify({
    mode: "serverless",
    endpoint: "ep1",
    url: "u",
    pricePerSecond: 1,
    idleSeconds: 5,
    limit: 1.6,
  });
  assert.deepEqual(await provider({}, usage).close(handle, new FakeRuntime()), {
    cost: 0.12,
    inputTokens: 9000,
    outputTokens: 300,
    requests: 4,
    maxInputTokens: 4000,
    tokensPerSecond: 41.5,
  });
  const runtime = new FakeRuntime();
  assert.deepEqual(await provider({}, "").close(handle, runtime), { cost: 1.6 });
  assert.match(runtime.logged("warning")[0] ?? "", /whole limit, US\$ 1\.60/);
});

test("close returns the run's billed times on the endpoint's worker, for the ledger's split", async () => {
  const report = (busy: unknown) =>
    JSON.stringify({
      requests: 1,
      inputTokens: 9,
      outputTokens: 3,
      cost: 0.02,
      start: 1,
      end: 2,
      busy,
    });
  const handle = JSON.stringify({
    mode: "serverless",
    endpoint: "ep1",
    url: "u",
    pricePerSecond: 0.001,
    idleSeconds: 5,
    limit: 1.6,
  });
  const busy = [
    [1_000, 11_000],
    [20_000, 30_000],
  ];
  const usage = await provider({}, report(busy)).close(handle, new FakeRuntime());
  assert.deepEqual(usage.busy, { endpoint: "ep1", pricePerSecond: 0.001, spans: busy });
  assert.equal(usage.cost, 0.02);
  // Times out of order, or not numbers, leave the run out of the split, at its own estimate.
  for (const wrong of [
    [
      [20_000, 30_000],
      [1_000, 11_000],
    ],
    [[1, "2"]],
    [[5, 1]],
    "x",
  ]) {
    const unsplit = await provider({}, report(wrong)).close(handle, new FakeRuntime());
    assert.equal(unsplit.busy, undefined);
    assert.equal(unsplit.cost, 0.02);
  }
});

test("a usage report too large for GitHub's job outputs leaves out the billed times", () => {
  const usage = { requests: 1, inputTokens: 9, outputTokens: 3, cost: 0.02, start: 1, end: 2 };
  const warnings: string[] = [];
  const few: [number, number][] = [[1, 2]];
  assert.equal(
    usageReport({ ...usage, busy: few }, (text) => warnings.push(text)).includes('"busy"'),
    true,
  );
  const many = Array.from({ length: 10_000 }, (_, i): [number, number] => [
    1_791_000_000_000 + i * 2,
    1_791_000_000_001 + i * 2,
  ]);
  const text = usageReport({ ...usage, busy: many }, (warning) => warnings.push(warning));
  assert.ok(text.length <= MAX_USAGE_CHARS);
  assert.deepEqual(JSON.parse(text), usage);
  assert.deepEqual(warnings, [
    "The run's 10000 billed time span(s) do not fit in the job's output; the run counts its own estimate, unsplit.",
  ]);
});

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

/**
 * The endpoint's job queue: each job completes with a chat answer, unless `hold` keeps it queued
 * until cancelled. Keeps the headers of each job's submission, and the jobs cancelled. `/health`
 * reports `workers`, or fails while they are undefined.
 */
async function endpointApi(hold = false) {
  const requests: IncomingMessage["headers"][] = [];
  const cancelled: string[] = [];
  const state = {
    hold,
    workers: undefined as Record<string, number> | undefined,
    healthCalls: 0,
  };
  let jobs = 0;
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    const path = request.url ?? "";
    let body: unknown;
    if (path === "/health") {
      state.healthCalls++;
      if (!state.workers) {
        response.writeHead(500).end("down");
        return;
      }
      body = { jobs: {}, workers: state.workers };
    } else if (path === "/run") {
      requests.push(request.headers);
      body = { id: `job${++jobs}`, status: "IN_QUEUE" };
    } else if (path.startsWith("/cancel/")) {
      cancelled.push(path.slice("/cancel/".length));
      body = { status: "CANCELLED" };
    } else if (cancelled.includes(path.slice("/stream/".length))) {
      body = { status: "CANCELLED", stream: [] };
    } else if (state.hold) {
      body = { status: "IN_QUEUE", stream: [] };
    } else {
      const answer = { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } };
      body = { status: "COMPLETED", stream: [{ output: answer }] };
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, requests, cancelled, state };
}

/** Waits until `/health` was asked twice more: the gateway then saw what it answers now. */
async function sampled(api: Awaited<ReturnType<typeof endpointApi>>): Promise<void> {
  const target = api.state.healthCalls + 2;
  while (api.state.healthCalls < target) await new Promise((resolve) => setTimeout(resolve, 2));
}

test("the agent job's gateway holds the endpoint's key; the agent sees a local URL and its token", async () => {
  const api = await endpointApi();
  const handle: ServerlessHandle = {
    mode: "serverless",
    endpoint: "ep1",
    url: api.url,
    pricePerSecond: 0.0003,
    idleSeconds: 5,
    limit: 1,
    contextLength: 65536,
  };
  const access = await agentAccess({
    mode: "serverless",
    credential: "run-token",
    handle: JSON.stringify(handle),
    serverlessKey: "rpa_endpoint_key",
    engine: vllm,
    pollMs: 1,
  });
  const { finish, ...seen } = access;
  assert.ok(!JSON.stringify(seen).includes("rpa_endpoint_key"));
  assert.match(access.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal(access.apiKey, "run-token");
  assert.equal(access.contextLength, 65536);

  const call = (token: string) =>
    fetch(`${access.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "m" }),
    }).then(async (response) => {
      await response.text();
      return response.status;
    });
  assert.equal(await call("rpa_endpoint_key"), 401, "the key itself does not open the gateway");
  assert.equal(await call("run-token"), 200);
  assert.equal(api.requests[0]?.authorization, "Bearer rpa_endpoint_key");
  const usage = await finish();
  assert.equal(usage?.requests, 1);
  assert.equal(usage?.inputTokens, 10);
  await assert.rejects(fetch(`${access.baseUrl}/chat/completions`), "the gateway is closed");
});

test("the agent job's gateway stops serving once the run's estimated cost reaches its limit", async () => {
  const api = await endpointApi();
  let now = 1_000_000;
  const access = await agentAccess({
    mode: "serverless",
    credential: "t",
    handle: JSON.stringify({
      mode: "serverless",
      endpoint: "ep1",
      url: api.url,
      pricePerSecond: 0.001,
      idleSeconds: 5,
      limit: 0.01,
    }),
    serverlessKey: "k",
    engine: vllm,
    now: () => now,
    pollMs: 1,
  });
  const call = () =>
    fetch(`${access.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: "{}",
    }).then(async (response) => {
      await response.text();
      return response.status;
    });
  // Each request, a minute apart, bills its 5 seconds of idle time: US$ 0.005.
  assert.equal(await call(), 200);
  now += 60_000;
  assert.equal(await call(), 200);
  now += 60_000;
  assert.equal(await call(), 402);
  assert.equal(api.requests.length, 2);
  await access.finish();
});

test("the agent job's gateway cancels the jobs the agent left waiting when the run ends", async () => {
  const api = await endpointApi(true);
  const access = await agentAccess({
    mode: "serverless",
    credential: "t",
    handle: JSON.stringify({
      mode: "serverless",
      endpoint: "ep1",
      url: api.url,
      pricePerSecond: 0.0003,
      idleSeconds: 5,
      limit: 1,
    }),
    serverlessKey: "k",
    engine: vllm,
    pollMs: 1,
  });
  // A request waits in the queue; the agent gives up on it, then the run ends with another.
  const gaveUp = new AbortController();
  const first = fetch(`${access.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: "Bearer t" },
    body: JSON.stringify({ stream: true }),
    signal: gaveUp.signal,
  }).catch(() => undefined);
  const second = fetch(`${access.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: "Bearer t" },
    body: JSON.stringify({ stream: true }),
  }).catch(() => undefined);
  while (api.requests.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  gaveUp.abort();
  await first;
  while (api.cancelled.length < 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await access.finish();
  await second;
  assert.deepEqual(api.cancelled.sort(), ["job1", "job2"]);
});

test("OpenRouter and pods need nothing from the agent job but their credential", async () => {
  const openrouter = await agentAccess({ mode: "openrouter", credential: "sk-or" });
  assert.equal(openrouter.apiKey, "sk-or");
  assert.equal(openrouter.baseUrl, undefined);
  const pod = await agentAccess({
    mode: "pod",
    credential: "t",
    baseUrl: "https://pod1-8080.proxy.runpod.net/v1",
    contextLength: 32768,
  });
  assert.equal(pod.baseUrl, "https://pod1-8080.proxy.runpod.net/v1");
  await assert.rejects(agentAccess({ mode: "pod", credential: "t" }), /URL is missing/);
});

/** A run's access through `api`: US$ 0.001 per second of a worker, and 5 seconds of idle time. */
function serverlessAccess(
  api: Awaited<ReturnType<typeof endpointApi>>,
  now: () => number,
  noWorkerMs?: number,
) {
  return agentAccess({
    mode: "serverless",
    credential: "t",
    handle: JSON.stringify({
      mode: "serverless",
      endpoint: "ep1",
      url: api.url,
      pricePerSecond: 0.001,
      idleSeconds: 5,
      limit: 10,
    }),
    serverlessKey: "k",
    engine: vllm,
    now,
    pollMs: 1,
    sampleMs: 1,
    noWorkerMs,
  });
}

const chatCall = (baseUrl: string | undefined) =>
  fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: "Bearer t" },
    body: JSON.stringify({ model: "m" }),
  }).then(async (response) => ({ status: response.status, text: await response.text() }));

const cents = (usd: number | undefined) => Math.round((usd ?? Number.NaN) * 100_000) / 1000;

test("the agent job's gateway counts a cold start from when /health sees a worker running", async () => {
  const api = await endpointApi(true);
  api.state.workers = { idle: 0, initializing: 1, running: 0 };
  let now = 1_000_000;
  const access = await serverlessAccess(api, () => now);
  const answered = chatCall(access.baseUrl);
  while (api.requests.length < 1) await new Promise((resolve) => setTimeout(resolve, 2));
  await sampled(api);
  // A minute in the queue while the worker initializes: not billed.
  now += 60_000;
  await sampled(api);
  // Then 30 seconds running, the model's load included, before the answer.
  api.state.workers = { idle: 0, initializing: 0, running: 1 };
  await sampled(api);
  now += 30_000;
  await sampled(api);
  api.state.hold = false;
  assert.equal((await answered).status, 200);
  const usage = await access.finish();
  // 30 seconds, and the idle timeout after the request: US$ 0.035.
  assert.equal(cents(usage?.cost), 3.5);
  assert.deepEqual(usage?.busy, [[1_060_000, 1_095_000]], "the times the estimate counts");
});

test("when /health fails, the agent job's gateway counts each request's whole span", async () => {
  const api = await endpointApi(true);
  let now = 1_000_000;
  const access = await serverlessAccess(api, () => now);
  const answered = chatCall(access.baseUrl);
  while (api.requests.length < 1) await new Promise((resolve) => setTimeout(resolve, 2));
  await sampled(api);
  now += 60_000;
  await sampled(api);
  api.state.hold = false;
  assert.equal((await answered).status, 200);
  assert.equal(cents((await access.finish())?.cost), 6.5);
});

test("a run whose request waits with no worker fails, and its wait costs nothing", async () => {
  const api = await endpointApi(true);
  api.state.workers = { idle: 1, running: 0, throttled: 1 };
  let now = 1_000_000;
  const access = await serverlessAccess(api, () => now, 25 * 60_000);
  const answered = chatCall(access.baseUrl);
  while (api.requests.length < 1) await new Promise((resolve) => setTimeout(resolve, 2));
  await sampled(api);
  now += 24 * 60_000;
  await sampled(api);
  assert.equal(access.stopped?.aborted, false);
  now += 60_000;
  await sampled(api);
  assert.equal(access.stopped?.aborted, true);
  const reason = /No worker of the endpoint started or ran for 25 minutes while a request waited/;
  assert.match(String(access.stopped?.reason), reason);
  const failed = await answered;
  assert.equal(failed.status, 503);
  assert.match(failed.text, reason);
  assert.equal((await chatCall(access.baseUrl)).status, 503, "the run is no longer served");
  const usage = await access.finish();
  assert.deepEqual(api.cancelled, ["job1"]);
  // Only the idle timeout after the request, which the end of sampling cannot see: US$ 0.005.
  assert.equal(usage?.requests, 1);
  assert.equal(cents(usage?.cost), 0.5);
});
