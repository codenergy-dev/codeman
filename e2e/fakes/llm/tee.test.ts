import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { contextCandidates, floorMessage } from "../../../src/gateway/fit.ts";
import { Gateway, sha256 } from "../../../src/gateway/gateway.ts";
import { FitFailure, prepareOllama } from "../../../src/gateway/pod.ts";
import { fakeEngine } from "../../../src/testing/fake-gpu.ts";
import { FakeServer, json } from "../http.ts";
import type { ChatRequest } from "../openrouter/chat.ts";
import { LlmFake } from "./llm.ts";
import { ScriptedModel } from "./model.ts";
import { scriptOf } from "./script.ts";
import { accumulate, type Send, Session, sseEvents, taskFile } from "./session.ts";
import { ENGINE_PROMPT, fromEnv, localScripts, remoteScripts, Tee, type TeeRecord } from "./tee.ts";

const MODEL = "qwen2.5:0.5b";
const DIGEST = "a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67";
const WEIGHTS = 397_821_319;
/** qwen2.5:0.5b's K/V per token: 24 layers, 2 K/V heads, 64 + 64, f16. */
const KV_PER_TOKEN = 24 * 2 * (64 + 64) * 2;
const PARALLEL = 2;
/** The model's own context, in the fake: larger than the spike's, so the search has candidates. */
const MODEL_CONTEXT = 131_072;

/** What the fake engine's `/api/ps` reports at a context: weights and K/V, all on the CPU. */
const sizeAt = (context: number) => WEIGHTS + KV_PER_TOKEN * context * PARALLEL;

/** A fake Ollama: its sizes follow the context it runs with, and it has no registry. */
class FakeOllama {
  readonly server = new FakeServer("ollama");
  context = 32_768;
  loaded = false;
  delayMs = 0;
  error: { status: number; body: unknown } | undefined;
  readonly chats: ChatRequest[] = [];
  readonly windows: { start: number; end: number }[] = [];

  constructor() {
    const server = this.server;
    server.route("GET", "/api/version", () => json({ version: "0.35.1" }));
    server.route("GET", "/api/tags", () =>
      json({ models: [{ name: MODEL, model: MODEL, digest: DIGEST, size: WEIGHTS }] }),
    );
    server.route("POST", "/api/show", () =>
      json({
        details: { family: "qwen2" },
        model_info: {
          "general.architecture": "qwen2",
          "qwen2.context_length": MODEL_CONTEXT,
          "qwen2.block_count": 24,
          "qwen2.embedding_length": 896,
          "qwen2.attention.head_count": 14,
          "qwen2.attention.head_count_kv": 2,
        },
      }),
    );
    server.route("POST", "/api/generate", () => {
      this.loaded = true;
      return json({ model: MODEL, done: true });
    });
    server.route("GET", "/api/ps", () =>
      json({
        models: this.loaded
          ? [
              {
                name: MODEL,
                model: MODEL,
                digest: DIGEST,
                size: sizeAt(this.context),
                size_vram: 0,
                context_length: this.context,
              },
            ]
          : [],
      }),
    );
    server.route("POST", "/api/pull", () =>
      json({ error: "dial tcp: lookup registry.ollama.ai: network is unreachable" }, 500),
    );
    server.route("GET", "/v1/models", () => json({ object: "list", data: [{ id: MODEL }] }));
    server.route("POST", "/v1/chat/completions", async (request, response) => {
      const body = request.json() as ChatRequest;
      this.chats.push(body);
      const start = Date.now();
      await sleep(this.delayMs);
      this.windows.push({ start, end: Date.now() });
      if (this.error) return json(this.error.body, this.error.status);
      const usage = { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 };
      const message = { role: "assistant", content: "OK" };
      if (!body.stream) {
        return json({ choices: [{ index: 0, message, finish_reason: "stop" }], usage });
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: message }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      response.end("data: [DONE]\n\n");
      return undefined;
    });
  }

  reset() {
    this.server.reset();
    this.context = 32_768;
    this.loaded = false;
    this.delayMs = 0;
    this.error = undefined;
    this.chats.length = 0;
    this.windows.length = 0;
  }
}

const SCENARIO = "pods/tee";
const SCRIPT = {
  i1: {
    code: [
      {
        usage: { prompt: 900, completion: 90 },
        steps: [
          { write: { path: "a.ts", content: "export {};\n" } },
          { output: { status: "done", summary: "Adds a.ts." } },
        ],
      },
    ],
  },
};

const engine = new FakeOllama();
const model = new ScriptedModel();
let engineOrigin = "";
let tee: Tee;
let teeOrigin = "";
let inspectionOrigin = "";
const closers: (() => Promise<void>)[] = [];
before(async () => {
  engineOrigin = await engine.server.listen();
  tee = new Tee({ engine: engineOrigin, script: localScripts(model) });
  teeOrigin = await tee.server.listen();
  inspectionOrigin = await tee.inspection.listen();
});
after(async () => {
  for (const close of closers) await close();
  await tee.server.close();
  await tee.inspection.close();
  await engine.server.close();
});
beforeEach(() => {
  engine.reset();
  tee.server.reset();
  model.reset();
  model.load(SCENARIO, scriptOf(SCRIPT));
});

function post(origin: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** An agent's request through the tee, timing when its reply's first byte came. */
async function timed(request: ChatRequest): Promise<{ text: string; firstByte: number }> {
  const response = await post(teeOrigin, "/v1/chat/completions", request);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  let firstByte = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    firstByte ||= Date.now();
    text += decoder.decode(value, { stream: true });
  }
  return { text, firstByte };
}

const throughTee: Send = async (request) => {
  const response = await post(teeOrigin, "/v1/chat/completions", request);
  assert.equal(response.status, 200, await response.clone().text());
  if (!request.stream) {
    // biome-ignore lint/suspicious/noExplicitAny: the body is the tee's, read field by field.
    const body = (await response.json()) as any;
    const choice = body.choices[0];
    return {
      content: choice.message.content ?? "",
      calls: choice.message.tool_calls ?? [],
      finish: choice.finish_reason,
      usage: body.usage,
    };
  }
  return accumulate(sseEvents(await response.text()));
};

test("the engine gets a short prompt, and the agent the scripted reply once the engine's ends", async () => {
  engine.delayMs = 250;
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  const { text, firstByte } = await timed(session.request());
  const window = engine.windows[0];
  assert.ok(window && firstByte >= window.end, "the reply waits for the engine's");
  const received = accumulate(sseEvents(text));
  assert.equal(received.calls[0]?.function.name, "read");

  assert.deepEqual(engine.chats[0], {
    model: "e2e-model",
    messages: [{ role: "user", content: ENGINE_PROMPT }],
    temperature: 0,
    max_tokens: 8,
    stream: true,
    stream_options: { include_usage: true },
    tools: [
      {
        type: "function",
        function: {
          name: "ping",
          description: "Checks that tools work. Takes no arguments.",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    tool_choice: "auto",
  });
  const [record] = tee.records;
  assert.equal(record?.kind, "agent");
  assert.deepEqual(record?.engine.usage, {
    prompt_tokens: 12,
    completion_tokens: 1,
    total_tokens: 13,
  });
  assert.equal(record?.engine.status, 200);
});

test("a whole round plays through the tee, streamed or as JSON", async () => {
  const runs = [];
  for (const stream of [true, false]) {
    model.reset();
    model.load(SCENARIO, scriptOf(SCRIPT));
    const session = new Session(taskFile(SCENARIO, "i1", "code"));
    runs.push(await session.run((request) => throughTee({ ...request, stream })));
    assert.equal(session.replies.at(-1)?.content, "Done.");
  }
  assert.equal(runs[0]?.length, 3);
  assert.deepEqual(runs[1], runs[0]);
  assert.equal(engine.chats.at(-1)?.stream, false);
});

test("concurrent requests are timestamped at the engine", async () => {
  engine.delayMs = 200;
  await Promise.all(
    [1, 2, 3].map(() => timed(new Session(taskFile(SCENARIO, "i1", "code")).request())),
  );
  const records = (await (
    await fetch(`${inspectionOrigin}/_fake/tee/requests`)
  ).json()) as TeeRecord[];
  assert.equal(records.length, 3);
  const windows = records.map((record) => [record.engine.start, record.engine.end ?? 0] as const);
  const overlapping = windows.filter(([start]) => windows.every(([, end]) => start < end)).length;
  assert.equal(overlapping, 3, "the three ran at once at the engine");
  assert.ok(records.every((record) => (record.end ?? 0) >= (record.engine.end ?? Infinity)));
});

test("an engine error goes back unchanged, and the script is not played", async () => {
  engine.error = { status: 503, body: { error: { message: "server busy", type: "overloaded" } } };
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  const response = await post(teeOrigin, "/v1/chat/completions", session.request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { message: "server busy", type: "overloaded" },
  });
  assert.equal(model.turns.length, 0);
  assert.match(tee.records[0]?.engine.error ?? "", /server busy/);
});

test("other requests reach the engine unchanged, the gateway's probe included", async () => {
  const probe = {
    model: MODEL,
    messages: [{ role: "user", content: "Call the ping tool now, with no arguments." }],
    tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }],
    tool_choice: "auto",
    max_tokens: 4096,
    temperature: 0,
  };
  const answer = await post(teeOrigin, "/v1/chat/completions", probe);
  assert.equal(answer.status, 200);
  assert.equal(
    ((await answer.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message
      .content,
    "OK",
  );
  assert.deepEqual(engine.chats[0], probe);
  assert.equal(tee.records[0]?.kind, "passthrough");
  assert.equal(model.turns.length, 0);

  assert.deepEqual(await (await fetch(`${teeOrigin}/api/version`)).json(), { version: "0.35.1" });
  assert.deepEqual(await (await fetch(`${teeOrigin}/v1/models`)).json(), {
    object: "list",
    data: [{ id: MODEL }],
  });
  const show = await post(teeOrigin, "/api/show", { model: MODEL });
  assert.equal(((await show.json()) as { details: { family: string } }).details.family, "qwen2");
  assert.deepEqual(
    engine.server.requests.map((request) => `${request.method} ${request.path}`),
    ["POST /v1/chat/completions", "GET /api/version", "GET /v1/models", "POST /api/show"],
  );
});

test("the pull is answered without a registry, as Ollama streams it", async () => {
  const lines = async (response: Response) =>
    (await response.text())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { status?: string; error?: string });
  const present = await lines(await post(teeOrigin, "/api/pull", { model: MODEL, stream: true }));
  assert.equal(present.at(-1)?.status, "success");
  assert.ok(present.every((line) => line.error === undefined));
  const whole = await post(teeOrigin, "/api/pull", { model: MODEL, stream: false });
  assert.deepEqual(await whole.json(), { status: "success" });

  const absent = await lines(await post(teeOrigin, "/api/pull", { model: "llama3.2:1b" }));
  assert.match(absent.at(-1)?.error ?? "", /has no llama3\.2:1b/);
  const absentWhole = await post(teeOrigin, "/api/pull", { model: "llama3.2:1b", stream: false });
  assert.equal(absentWhole.status, 500);
  assert.ok(!engine.server.requests.some((request) => request.path === "/api/pull"));
});

/** The gateway's Ollama, through the tee: a restart changes the engine's context. */
const ollamaServer = () => ({
  url: teeOrigin,
  restart: async (context: number | undefined) => {
    engine.context = context ?? 32_768;
    engine.loaded = false;
  },
  wait: async () => {},
});

test("with the virtual VRAM, Codeman's own fit searches on the engine's real sizes", async () => {
  const candidates = contextCandidates(MODEL_CONTEXT);
  // A budget between two candidates' sizes: the search must find the smaller.
  const best = candidates[3] as number;
  tee.vramBytes = Math.floor((sizeAt(best) + sizeAt(candidates[4] as number)) / 2);
  const logs: string[] = [];
  const fit = await prepareOllama(ollamaServer(), MODEL, (line) => logs.push(line), {
    parallel: PARALLEL,
  });
  assert.equal(fit.contextLength, best);
  assert.equal(fit.source, "search");
  assert.equal(fit.sizeVram, fit.size);
  assert.ok(fit.loads > 1);
  assert.ok(!engine.server.requests.some((request) => request.path === "/api/pull"));

  // Without the rewrite, a CPU engine puts nothing on the GPU: the spike's floor failure.
  const floor = candidates[0] as number;
  for (const vram of [undefined, sizeAt(floor) - 1]) {
    engine.reset();
    const set = await fetch(`${inspectionOrigin}/_fake/tee/vram`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bytes: vram ?? null }),
    });
    assert.equal(set.status, 204);
    await assert.rejects(
      prepareOllama(ollamaServer(), MODEL, () => {}, { parallel: PARALLEL }),
      (error: unknown) =>
        error instanceof FitFailure &&
        error.message ===
          floorMessage(MODEL, PARALLEL, floor, {
            size: sizeAt(floor),
            sizeVram: vram ?? 0,
            contextLength: floor,
          }),
    );
  }
});

test("the shipped gateway runs in front of the tee", async () => {
  const gateway = new Gateway({
    upstream: `${teeOrigin}/v1`,
    engine: fakeEngine,
    adminSha256: sha256("admin"),
  });
  gateway.ready = true;
  const { server, url } = await gateway.listen();
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  gateway.startRun({
    tokenSha256: sha256("run-token"),
    limit: 1,
    start: Date.now(),
    meter: { kind: "time", pricePerSecond: 0.0002 },
  });
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  const calls = await session.run(async (request) => {
    const response = await post(url, "/v1/chat/completions", request, {
      authorization: "Bearer run-token",
    });
    assert.equal(response.status, 200);
    return accumulate(sseEvents(await response.text()));
  });
  assert.deepEqual(
    calls.map((call) => call.function.name),
    ["read", "write", "write"],
  );
  assert.equal(engine.chats.length, 4);
  assert.ok(engine.chats.every((chat) => chat.max_tokens === 8));
  assert.deepEqual(
    session.replies.slice(1).map((received) => received.usage?.prompt_tokens),
    [900, 900, 900],
  );
});

test("the scripted model's server can be the replies' source, an exit included", async () => {
  const llm = new LlmFake();
  const llmOrigin = await llm.server.listen();
  closers.push(() => llm.server.close());
  llm.model.load(SCENARIO, scriptOf({ i1: { code: [{ steps: [{ bash: "npm test" }, "exit"] }] } }));
  const remote = new Tee({ engine: engineOrigin, script: remoteScripts(llmOrigin) });
  const origin = await remote.server.listen();
  closers.push(() => remote.server.close());
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  const send: Send = async (request) => {
    const response = await post(origin, "/v1/chat/completions", request);
    return accumulate(sseEvents(await response.text()));
  };
  await session.step(send);
  assert.equal((await session.step(send)).calls[0]?.function.name, "bash");
  // The drop reaches the client before or after the reply's headers: either way, no reply.
  await assert.rejects(
    post(origin, "/v1/chat/completions", session.request()).then((response) => response.text()),
  );
  assert.equal(llm.model.turns.length, 3);
  assert.ok(llm.model.turns.every((turn) => turn.via === "openai"));
});

test("the tee's environment names the engine and one source of scripts", async () => {
  await assert.rejects(fromEnv({ TEE_ENGINE: engineOrigin }), /one of TEE_MODEL/);
  await assert.rejects(
    fromEnv({ TEE_ENGINE: `${engineOrigin}/v1`, TEE_MODEL: "http://llm:8080" }),
    /TEE_ENGINE must be an origin/,
  );
  await assert.rejects(
    fromEnv({ TEE_ENGINE: engineOrigin, TEE_MODEL: "http://llm:8080", TEE_VRAM_BYTES: "lots" }),
    /TEE_VRAM_BYTES must be a count/,
  );
});
