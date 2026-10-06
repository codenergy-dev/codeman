import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpstreamResponse } from "./gateway.ts";
import { RunpodQueue } from "./queue.ts";

interface Call {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

/**
 * Runpod's job API: `/run` queues job `j1`, and each `/stream` answers the next page given, the
 * last one again once they run out, until `/cancel` cancels the job.
 */
function runpod(pages: (Record<string, unknown> | number | Error)[], run: number | object = {}) {
  const calls: Call[] = [];
  let next = 0;
  let cancelled = false;
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = url.slice("https://api.runpod.ai/v2/ep1".length);
    const headers = init.headers as Record<string, string>;
    calls.push({
      method: init.method ?? "GET",
      path,
      authorization: headers.Authorization,
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    if (init.signal?.aborted) throw init.signal.reason;
    if (path === "/run") {
      if (typeof run === "number") return new Response("no", { status: run });
      return Response.json({ id: "j1", status: "IN_QUEUE", ...run });
    }
    if (path === "/cancel/j1") {
      cancelled = true;
      return Response.json({ id: "j1", status: "CANCELLED" });
    }
    if (cancelled) return Response.json({ status: "CANCELLED", stream: [] });
    const page = pages[Math.min(next++, pages.length - 1)];
    if (page instanceof Error) throw page;
    if (typeof page === "number") return new Response("oops", { status: page });
    return Response.json(page);
  }) as typeof fetch;
  const queue = new RunpodQueue("https://api.runpod.ai/v2/ep1", "rpa_key", {
    fetch: fetchFn,
    pollMs: 1,
  });
  return { queue, calls };
}

async function text(response: UpstreamResponse): Promise<string> {
  let all = "";
  for await (const chunk of response.body) all += String(chunk);
  return all;
}

const chat = (stream: boolean) => ({
  method: "POST",
  path: "/v1/chat/completions",
  body: JSON.stringify({ model: "m", stream }),
  signal: new AbortController().signal,
});

test("a request becomes a job, whose output streams once a worker takes it", async () => {
  const { queue, calls } = runpod([
    { status: "IN_QUEUE", stream: [] },
    { status: "IN_QUEUE", stream: [] },
    { status: "IN_PROGRESS", stream: [{ output: 'data: {"a":1}\n\n' }] },
    { status: "IN_PROGRESS", stream: [] },
    { status: "COMPLETED", stream: [{ output: "data: [DONE]\n\n" }] },
  ]);
  const response = await queue.send(chat(true));
  assert.equal(response.status, 200);
  assert.equal(response.contentType, "text/event-stream");
  assert.equal(await text(response), 'data: {"a":1}\n\ndata: [DONE]\n\n');
  assert.deepEqual(calls[0], {
    method: "POST",
    path: "/run",
    authorization: "Bearer rpa_key",
    body: {
      input: { openai_route: "/v1/chat/completions", openai_input: { model: "m", stream: true } },
      policy: { executionTimeout: 1_800_000, ttl: 3_600_000 },
    },
  });
  assert.ok(calls.slice(1).every((call) => call.path === "/stream/j1"));
  await queue.settle();
  assert.ok(!calls.some((call) => call.path.startsWith("/cancel")), "a finished job stays");
});

test("a plain answer is the worker's JSON; a route without a body is a GET", async () => {
  const { queue, calls } = runpod([
    { status: "COMPLETED", stream: [{ output: { object: "list", data: [] } }] },
  ]);
  const response = await queue.send({
    method: "GET",
    path: "/v1/models",
    body: undefined,
    signal: new AbortController().signal,
  });
  assert.equal(response.contentType, "application/json");
  assert.deepEqual(JSON.parse(await text(response)), { object: "list", data: [] });
  assert.deepEqual(calls[0]?.body, {
    input: { openai_route: "/v1/models" },
    policy: { executionTimeout: 1_800_000, ttl: 3_600_000 },
  });
});

test("a job nobody waits for anymore is cancelled, in the queue or while it streams", async () => {
  const queued = runpod([{ status: "IN_QUEUE", stream: [] }]);
  const abort = new AbortController();
  const waiting = queued.queue.send({ ...chat(true), signal: abort.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  abort.abort();
  await assert.rejects(waiting);
  await queued.queue.settle();
  assert.equal(queued.calls.filter((call) => call.path === "/cancel/j1").length, 1);

  const streaming = runpod([{ status: "IN_PROGRESS", stream: [{ output: "data: {}\n\n" }] }]);
  const stop = new AbortController();
  const response = await streaming.queue.send({ ...chat(true), signal: stop.signal });
  const reader = response.body[Symbol.asyncIterator]();
  assert.equal((await reader.next()).value, "data: {}\n\n");
  stop.abort();
  await assert.rejects(async () => {
    for (;;) if ((await reader.next()).done) break;
  });
  await streaming.queue.settle();
  assert.equal(streaming.calls.filter((call) => call.path === "/cancel/j1").length, 1);
});

test("the run's end cancels the jobs still open", async () => {
  const { queue, calls } = runpod([{ status: "IN_QUEUE", stream: [] }]);
  const waiting = queue.send(chat(true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await queue.settle();
  assert.equal(calls.filter((call) => call.path === "/cancel/j1").length, 1);
  const response = await waiting;
  assert.equal(response.status, 502);
  assert.match(await text(response), /ended CANCELLED/);
});

test("the worker's error, a failed job and Runpod's refusal reach the agent as errors", async () => {
  const error = { error: { message: "vLLM returned HTTP 400: bad", type: "worker_error" } };
  const worker = await runpod([{ status: "COMPLETED", stream: [{ output: error }] }]).queue.send(
    chat(false),
  );
  assert.equal(worker.status, 502);
  assert.match(await text(worker), /vLLM returned HTTP 400: bad/);

  const job = await runpod([{ status: "FAILED", stream: [], error: "handler crashed" }]).queue.send(
    chat(true),
  );
  assert.equal(job.status, 502);
  assert.match(await text(job), /Runpod job j1 ended FAILED: handler crashed/);

  const refused = await runpod([], 401).queue.send(chat(true));
  assert.equal(refused.status, 401);
  assert.match(await text(refused), /no/);
});

test("a job that fails while streaming ends the stream with an error", async () => {
  const { queue } = runpod([
    { status: "IN_PROGRESS", stream: [{ output: "data: {}\n\n" }] },
    { status: "FAILED", stream: [], error: "worker lost" },
  ]);
  const response = await queue.send(chat(true));
  await assert.rejects(text(response), /ended FAILED: worker lost/);
});

test("a few failed polls are tolerated; five in a row fail the request", async () => {
  const flaky = runpod([
    500,
    new Error("socket hang up"),
    { status: "COMPLETED", stream: [{ output: "data: [DONE]\n\n" }] },
  ]);
  assert.equal(await text(await flaky.queue.send(chat(true))), "data: [DONE]\n\n");

  const down = runpod([503]);
  await assert.rejects(down.queue.send(chat(true)), /Runpod GET \/stream failed: 503: oops/);
  await down.queue.settle();
  assert.equal(down.calls.filter((call) => call.path === "/cancel/j1").length, 1);

  const gone = runpod([404]);
  await assert.rejects(gone.queue.send(chat(true)), /404/);
  assert.equal(gone.calls.filter((call) => call.path === "/stream/j1").length, 1);
});
