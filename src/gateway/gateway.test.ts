import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { fakeEngine } from "../testing/fake-gpu.ts";
import { Gateway, type GatewayOptions, runSettings, sha256, type Upstream } from "./gateway.ts";

/** An OpenAI-compatible engine: answers each request as `respond` says, and keeps the bodies. */
async function engine(
  respond: (
    body: Record<string, unknown>,
    request: IncomingMessage,
  ) => {
    status?: number;
    delayMs?: number;
    chunks: string[];
    type?: string;
  },
): Promise<{
  url: string;
  bodies: Record<string, unknown>[];
  headers: IncomingMessage["headers"][];
}> {
  const bodies: Record<string, unknown>[] = [];
  const headers: IncomingMessage["headers"][] = [];
  const server: Server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    bodies.push(body);
    headers.push(request.headers);
    const answer = respond(body, request);
    await new Promise((resolve) => setTimeout(resolve, answer.delayMs ?? 0));
    response.writeHead(answer.status ?? 200, {
      "Content-Type": answer.type ?? "application/json",
    });
    for (const chunk of answer.chunks) {
      response.write(chunk);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies, headers };
}

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

async function gateway(options: Partial<GatewayOptions> & { upstream: string }) {
  const instance = new Gateway({ engine: fakeEngine, adminSha256: sha256("admin"), ...options });
  instance.ready = true;
  const { server, url } = await instance.listen();
  servers.push(server);
  return { instance, url };
}

const completion = {
  choices: [{ message: { role: "assistant", content: "Hi" } }],
  usage: { prompt_tokens: 1200, completion_tokens: 30 },
};

/** Calls the gateway and reads the whole answer, as a client does before its next request. */
async function call(url: string, token: string, body: unknown = { model: "m", messages: [] }) {
  const response = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

const run = (token: string, limit = 1) => ({
  tokenSha256: sha256(token),
  limit,
  start: Date.now(),
  meter: { kind: "time" as const, pricePerSecond: 0.0002 },
});

test("rejects a request without the run's token, and when no run is served", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  const { instance, url } = await gateway({ upstream: upstream.url });
  assert.equal((await call(url, "t1")).status, 401, "no run yet");
  instance.startRun(run("t1"));
  assert.equal((await call(url, "wrong")).status, 401);
  const unauthenticated = await fetch(`${url}/v1/chat/completions`, { method: "POST", body: "{}" });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await fetch(`${url}/api/pull`, { method: "POST" })).status, 404);
  assert.equal(upstream.bodies.length, 0, "nothing reached the engine");
});

test("a new run's token replaces the last one, and ending the run revokes it", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  const { instance, url } = await gateway({ upstream: upstream.url });
  instance.startRun(run("first"));
  assert.equal((await call(url, "first")).status, 200);
  instance.startRun(run("second"));
  assert.equal((await call(url, "first")).status, 401);
  assert.equal((await call(url, "second")).status, 200);
  instance.endRun();
  assert.equal((await call(url, "second")).status, 401);
});

test("forwards a request with the engine's own headers, and records its usage", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  const { instance, url } = await gateway({
    upstream: upstream.url,
    upstreamHeaders: { Authorization: "Bearer engine-key" },
  });
  instance.startRun(run("t"));
  const response = await call(url, "t", { model: "m", messages: [{ role: "user", content: "x" }] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), completion);
  assert.equal(upstream.headers[0]?.authorization, "Bearer engine-key");
  assert.deepEqual(upstream.bodies[0], { model: "m", messages: [{ role: "user", content: "x" }] });
  const usage = instance.usage();
  assert.equal(usage?.requests, 1);
  assert.equal(usage?.inputTokens, 1200);
  assert.equal(usage?.outputTokens, 30);
  assert.equal(usage?.maxInputTokens, 1200);
});

test("streams a response as it comes, asking the engine for usage in its last chunk", async () => {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 2 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const upstream = await engine(() => ({ chunks, type: "text/event-stream" }));
  const { instance, url } = await gateway({ upstream: upstream.url });
  instance.startRun(run("t"));
  const response = await call(url, "t", { model: "m", messages: [], stream: true });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(await response.text(), chunks.join(""));
  assert.deepEqual(upstream.bodies[0]?.stream_options, { include_usage: true });
  const usage = instance.usage();
  assert.equal(usage?.inputTokens, 50);
  assert.equal(usage?.outputTokens, 2);
  assert.ok((usage?.tokensPerSecond ?? 0) > 0);
});

test("keeps a stream alive while the engine has not answered, and passes on a late error", async () => {
  const slow = await engine(() => ({
    delayMs: 120,
    chunks: [`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`],
    type: "text/event-stream",
  }));
  const { instance, url } = await gateway({ upstream: slow.url, keepAliveMs: 30 });
  instance.startRun(run("t"));
  const text = await (await call(url, "t", { model: "m", stream: true })).text();
  assert.match(text, /^: keep-alive\n\n/);
  assert.match(text, /"content":"ok"/);

  const failing = await engine(() => ({ delayMs: 120, status: 500, chunks: ["engine broke"] }));
  const second = await gateway({ upstream: failing.url, keepAliveMs: 30 });
  second.instance.startRun(run("t"));
  const failed = await call(second.url, "t", { model: "m", stream: true });
  assert.equal(failed.status, 200, "the stream had started");
  assert.match(
    await failed.text(),
    /data: \{"error":\{"message":"Codeman gateway: engine broke","code":"upstream_500"\}\}/,
  );
});

test("stops serving once the run's budget is spent", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  let now = 1_000_000;
  const { instance, url } = await gateway({ upstream: upstream.url, now: () => now });
  // US$ 0.72 per hour: US$ 0.01 lasts 50 seconds.
  instance.startRun({ ...run("t", 0.01), start: now });
  assert.equal(instance.deadline, now + 50_000);
  assert.equal((await call(url, "t")).status, 200);
  now += 50_000;
  const refused = await call(url, "t");
  assert.equal(refused.status, 402);
  assert.equal(
    ((await refused.json()) as { error: { code: string } }).error.code,
    "budget_exceeded",
  );
  assert.equal(upstream.bodies.length, 1);
});

test("a Serverless run is billed while busy, so its budget lasts through idle time", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  let now = 1_000_000;
  const { instance, url } = await gateway({ upstream: upstream.url, now: () => now });
  instance.startRun({
    tokenSha256: sha256("t"),
    limit: 0.01,
    start: now,
    meter: { kind: "busy", pricePerSecond: 0.0002, idleMs: 5_000 },
  });
  assert.equal((await call(url, "t")).status, 200);
  now += 3_600_000;
  assert.equal((await call(url, "t")).status, 200, "an hour later, only 10 seconds were billed");
  assert.equal(instance.usage()?.cost, 0.002);
});

const busyRun = (start: number, limit = 1) => ({
  tokenSha256: sha256("t"),
  limit,
  start,
  meter: { kind: "busy" as const, pricePerSecond: 0.001, idleMs: 0 },
});

const answer: Upstream = async () => ({
  status: 200,
  contentType: "application/json",
  body: (async function* () {
    yield JSON.stringify(completion);
  })(),
});

test("a Serverless run's budget counts only the time a worker ran", async () => {
  let now = 1_000_000;
  // Each request waits a minute in the queue: US$ 0.06 at the price of a worker's time.
  const send: Upstream = async (request) => {
    now += 60_000;
    return answer(request);
  };
  const { instance, url } = await gateway({ upstream: "unused", send, now: () => now });
  instance.startRun(busyRun(now, 0.05));
  instance.observe({ at: now, workers: "none" });
  assert.equal((await call(url, "t")).status, 200);
  instance.observe({ at: now, workers: "none" });
  assert.equal((await call(url, "t")).status, 200, "no worker ran: nothing was spent");
  // A worker ran during the second request, so its minute counts.
  instance.observe({ at: now, workers: "running" });
  assert.equal(instance.usage()?.cost, 0.06);
  assert.equal((await call(url, "t")).status, 402);
});

/** An endpoint whose requests wait until they are aborted, as when no worker comes. */
const waiting: Upstream = (request) =>
  new Promise((_, reject) => {
    request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
  });

test("a request that waits with no worker for the limit stops the run", async () => {
  let now = 1_000_000;
  const stops: string[] = [];
  const { instance, url } = await gateway({
    upstream: "unused",
    send: waiting,
    now: () => now,
    noWorkerMs: 60_000,
    onStop: (reason) => stops.push(reason),
  });
  instance.startRun(busyRun(now));
  // Without a request open, no worker is needed.
  instance.observe({ at: now, workers: "none" });
  now += 60_000;
  instance.observe({ at: now, workers: "none" });
  assert.ok(instance.serving);

  const request = call(url, "t", { model: "m", stream: true });
  while (!instance.usage()?.requests) await new Promise((resolve) => setTimeout(resolve, 5));
  const sample = (workers: "running" | "starting" | "none" | undefined, after: number) => {
    now += after;
    instance.observe({ at: now, workers });
  };
  sample("none", 0);
  sample("starting", 30_000);
  sample("none", 10_000);
  sample(undefined, 30_000);
  sample("none", 20_000);
  assert.ok(instance.serving, "a starting worker counts, and an unknown sample does not end it");
  sample("none", 10_000);
  assert.ok(!instance.serving);

  const reason = /No worker of the endpoint started or ran for 1 minutes while a request waited/;
  const failed = await request;
  assert.match(await failed.text(), reason);
  assert.match(stops[0] ?? "", reason);
  const refused = await call(url, "t");
  assert.equal(refused.status, 503);
  assert.match(await refused.text(), /"code":"run_stopped"/);
  assert.equal((await call(url, "other")).status, 401);
  // No worker ran, but the 50 seconds on either side of the unknown sample count.
  assert.equal(instance.endRun()?.cost, 0.05);
});

test("reports usage and manages runs only with the admin token", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  const { url } = await gateway({ upstream: upstream.url });
  const admin = (path: string, token: string, body?: unknown) =>
    fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: body === undefined ? null : JSON.stringify(body),
    });
  assert.equal((await admin("/usage", "t")).status, 401);
  const started = await admin("/admin/run", "admin", {
    tokenSha256: sha256("t"),
    limit: 1,
    start: Date.now(),
    pricePerSecond: 0.0002,
  });
  assert.equal(started.status, 200);
  assert.equal((await admin("/admin/run", "admin", { limit: 1 })).status, 400);
  await call(url, "t");
  const usage = (await (await admin("/usage", "admin")).json()) as Record<string, number>;
  assert.equal(usage.requests, 1);
  assert.equal(usage.inputTokens, 1200);
  const ended = (await (await admin("/admin/end", "admin", {})).json()) as Record<string, number>;
  assert.equal(ended.outputTokens, 30);
  assert.equal((await call(url, "t")).status, 401);
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ready: true });
});

test("reads a run from the admin route only with every field in range", () => {
  const hash = sha256("t");
  assert.deepEqual(
    runSettings({ tokenSha256: hash, limit: 1, start: 5, pricePerSecond: 0.1 })?.meter,
    {
      kind: "time",
      pricePerSecond: 0.1,
    },
  );
  assert.deepEqual(
    runSettings({ tokenSha256: hash, limit: 1, start: 5, pricePerSecond: 0.1, idleSeconds: 5 })
      ?.meter,
    { kind: "busy", pricePerSecond: 0.1, idleMs: 5000 },
  );
  assert.equal(
    runSettings({ tokenSha256: "x", limit: 1, start: 5, pricePerSecond: 0.1 }),
    undefined,
  );
  assert.equal(
    runSettings({ tokenSha256: hash, limit: -1, start: 5, pricePerSecond: 0.1 }),
    undefined,
  );
  assert.equal(runSettings(null), undefined);
});

/** A pod's run of a task, at US$ 0.72 per hour. */
const taskRun = (token: string, task: string, start: number, limit = 1) => ({
  ...run(token, limit),
  start,
  task,
});

test("serves several runs at once, each to its own token, and ending one leaves the others", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  const { instance, url } = await gateway({ upstream: upstream.url });
  instance.startRun(taskRun("a", "7", Date.now()));
  instance.startRun(taskRun("b", "8", Date.now()));
  assert.equal((await call(url, "a")).status, 200);
  assert.equal((await call(url, "b")).status, 200);
  assert.equal((await call(url, "b")).status, 200);
  assert.equal(instance.usage(sha256("a"))?.requests, 1, "each run counts its own requests");
  assert.equal(instance.usage(sha256("b"))?.requests, 2);
  instance.endRun({ tokenSha256: sha256("a") });
  assert.equal((await call(url, "a")).status, 401);
  assert.equal((await call(url, "b")).status, 200);
  assert.ok(instance.serving);
  // A task's new run replaces its own last one only.
  instance.startRun(taskRun("c", "8", Date.now()));
  assert.equal((await call(url, "b")).status, 401);
  assert.equal((await call(url, "c")).status, 200);
  assert.deepEqual(instance.status().active, ["8"]);
});

test("splits each second of the pod among the runs on it, so a run that ends first pays less", async () => {
  let now = 1_000_000;
  const { instance } = await gateway({ upstream: "unused", now: () => now });
  instance.startRun(taskRun("a", "7", now));
  instance.startRun(taskRun("b", "8", now));
  now += 60_000;
  // A minute shared by two: 30 seconds each, US$ 0.006.
  const first = instance.endRun({ tokenSha256: sha256("a") });
  assert.ok(Math.abs((first?.cost ?? 0) - 0.006) < 1e-12);
  now += 60_000;
  const second = instance.endRun({ tokenSha256: sha256("b") });
  assert.ok(
    Math.abs((second?.cost ?? 0) - 0.018) < 1e-12,
    "half the first minute, the second whole",
  );
  assert.deepEqual(second?.share?.tasks, ["7", "8"]);
  assert.deepEqual(second?.share?.active, []);
  // Together, the pod's two minutes.
  assert.ok(Math.abs((first?.cost ?? 0) + (second?.cost ?? 0) - 0.024) < 1e-12);
  assert.ok(
    Math.abs((instance.usage(sha256("a"))?.cost ?? 0) - 0.006) < 1e-12,
    "an ended run's cost no longer grows",
  );
});

test("the pod's time between runs goes to the tasks that keep it, until each one's next run or release", async () => {
  let now = 1_000_000;
  const { instance } = await gateway({ upstream: "unused", now: () => now });
  instance.startRun(taskRun("a", "7", now));
  instance.startRun(taskRun("b", "8", now));
  now += 100_000;
  instance.endRun({ tokenSha256: sha256("a"), keep: true });
  // Task 8's run still uses the pod: task 7 keeps it for nothing meanwhile.
  now += 100_000;
  const b = instance.endRun({ tokenSha256: sha256("b"), keep: true });
  assert.deepEqual(b?.share?.keepers, ["7", "8"]);
  assert.ok(Math.abs((b?.share?.taskCost ?? 0) - 0.03) < 1e-12, "50 seconds, then 100");
  now += 100_000;
  instance.release("8");
  assert.deepEqual(instance.status().keepers, ["7"]);
  now += 100_000;
  instance.startRun(taskRun("c", "7", now));
  now += 100_000;
  const c = instance.endRun({ tokenSha256: sha256("c") });
  assert.ok(Math.abs((c?.cost ?? 0) - 0.02) < 1e-12, "its run alone");
  // Task 7: 50 seconds of its first run, 50 kept with task 8, 100 kept alone, and its new run.
  assert.ok(Math.abs((c?.share?.taskCost ?? 0) - 0.06) < 1e-12);
  assert.deepEqual(c?.share?.keepers, [], "a run that does not keep the pod gives it up");
});

test("a run's budget is its share; a spent run stops alone while the others go on", async () => {
  const upstream = await engine(() => ({ chunks: [JSON.stringify(completion)] }));
  let now = 1_000_000;
  const { instance, url } = await gateway({ upstream: upstream.url, now: () => now });
  // US$ 0.01 lasts 50 seconds alone, 100 when shared.
  instance.startRun(taskRun("a", "7", now, 0.01));
  instance.startRun(taskRun("b", "8", now));
  assert.equal(instance.runs[0]?.deadline, now + 50_000, "as if alone from now");
  now += 60_000;
  assert.equal((await call(url, "a")).status, 200);
  assert.equal(instance.runs[0]?.deadline, now + 20_000, "US$ 0.004 left, 20 seconds alone");
  now += 40_000;
  assert.equal((await call(url, "a")).status, 402);
  instance.expireRuns(30 * 60_000);
  assert.deepEqual(instance.status().active, ["8"]);
  assert.equal((await call(url, "a")).status, 503);
  assert.equal((await call(url, "b")).status, 200);
  assert.ok(Math.abs((instance.usage(sha256("a"))?.cost ?? 0) - 0.01) < 1e-12);
});

test("the admin routes start, end and release the runs of tasks, and report the pod's runs", async () => {
  let now = 1_000_000;
  const { url } = await gateway({ upstream: "unused", now: () => now });
  const admin = async (path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer admin" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const start = { limit: 1, start: now, pricePerSecond: 0.0002, group: "300.ab12" };
  await admin("/admin/run", { ...start, tokenSha256: sha256("a"), task: "7" });
  await admin("/admin/run", { ...start, tokenSha256: sha256("b"), task: "8" });
  assert.equal(
    (await admin("/admin/run", { ...start, tokenSha256: sha256("c"), task: "x" })).status,
    400,
  );
  const status = (await admin("/admin/status")).body;
  assert.equal(status.version, 2);
  assert.equal(status.group, "300.ab12");
  assert.deepEqual(status.active, ["7", "8"]);
  now += 10_000;
  const ended = (await admin("/admin/end", { tokenSha256: sha256("a"), keep: true })).body;
  assert.ok(Math.abs((ended.cost as number) - 0.001) < 1e-12);
  assert.deepEqual(ended.share, {
    taskCost: ended.cost,
    tasks: ["7", "8"],
    active: ["8"],
    keepers: ["7"],
  });
  const released = (await admin("/admin/release", { task: "7" })).body;
  assert.deepEqual(released.keepers, []);
  assert.deepEqual(released.active, ["8"]);
  assert.equal((await admin("/admin/release", { task: "../7" })).status, 400);
});
