import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { FakeGpu } from "../testing/fake-gpu.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { agentAccess } from "./access.ts";
import type { Endpoint } from "./gpu.ts";
import {
  type ServerlessHandle,
  ServerlessInference,
  type ServerlessSettings,
} from "./selfhosted.ts";
import { vllm, vllmContextLength, vllmProblems } from "./vllm.ts";

const settings: ServerlessSettings = {
  model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  engine: vllm,
  taskSpent: 0.4,
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
  gpu.month = 3;
  return new ServerlessInference(settings, gpu, { usage });
}

test("a run checks the endpoint and prices its workers; the agent gets only a token", async () => {
  const serverless = provider();
  assert.equal(await serverless.taskSpent(), 0.4);
  assert.equal(await serverless.monthSpent(), 3);
  const opened = await serverless.open({ task: "7", runId: "300", limit: 1.6 }, new FakeRuntime());
  const handle = JSON.parse(opened.handle) as ServerlessHandle;
  assert.deepEqual(handle, {
    mode: "serverless",
    endpoint: "ep1",
    url: "https://serverless.test/ep1/openai/v1",
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

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

/** The endpoint's OpenAI-compatible API: answers every request, and keeps what it was sent. */
async function endpointApi(): Promise<{ url: string; requests: IncomingMessage["headers"][] }> {
  const requests: IncomingMessage["headers"][] = [];
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    requests.push(request.headers);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1`, requests };
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
