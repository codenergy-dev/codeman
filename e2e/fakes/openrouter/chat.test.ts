import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { HttpError } from "../http.ts";
import type { ChatChunk } from "./chat.ts";
import { OpenRouterFake } from "./openrouter.ts";

/** A JSON body, read loosely: each test checks the fields it needs. */
// biome-ignore lint/suspicious/noExplicitAny: the bodies are the fake's, checked field by field.
type Json = any;

const MANAGEMENT = "sk-or-v1-management-e2e";
const fake = new OpenRouterFake({
  managementKey: MANAGEMENT,
  prices: { prompt: 0.001, completion: 0.002 },
});
let origin = "";
let key = "";
before(async () => {
  origin = await fake.server.listen();
});
after(() => fake.server.close());
beforeEach(async () => {
  fake.server.reset();
  const response = await fetch(`${origin}/api/v1/keys`, {
    method: "POST",
    headers: { authorization: `Bearer ${MANAGEMENT}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "codeman/acme/app/1/7", limit: 1 }),
  });
  key = ((await response.json()) as { key: string }).key;
});

function complete(stream: boolean) {
  return fetch(`${origin}/api/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o",
      stream,
      messages: [{ role: "user", content: "Write the file." }],
    }),
  });
}

/** The SSE's data events, parsed, and its comments. */
async function events(response: Response): Promise<{ data: Json[]; comments: string[] }> {
  const blocks = (await response.text()).split("\n\n").filter((block) => block !== "");
  const comments = blocks.filter((block) => block.startsWith(":"));
  const data = blocks
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice("data: ".length))
    .map((text) => (text === "[DONE]" ? text : JSON.parse(text)));
  return { data, comments };
}

const TOOL_CALL: ChatChunk[] = [
  { delta: { content: "Writing." } },
  {
    delta: {
      tool_calls: [
        { index: 0, id: "call_1", type: "function", function: { name: "write", arguments: "" } },
      ],
    },
  },
  { delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } },
  { delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] } },
  { finish_reason: "tool_calls" },
  { usage: { prompt_tokens: 100, completion_tokens: 20 } },
];

async function* stream(chunks: ChatChunk[]): AsyncGenerator<ChatChunk> {
  yield* chunks;
}

test("a stream ends with a usage chunk that repeats the finish reason, then [DONE]", async () => {
  fake.completions(undefined, () => stream(TOOL_CALL));
  const response = await complete(true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const { data, comments } = await events(response);
  assert.deepEqual(comments, [": OPENROUTER PROCESSING"]);
  assert.equal(data.at(-1), "[DONE]");
  const chunks = data.slice(0, -1);
  assert.ok(chunks.every((chunk) => chunk.object === "chat.completion.chunk"));
  assert.equal(chunks[0].choices[0].delta.role, "assistant");
  assert.equal(chunks[0].choices[0].delta.content, "Writing.");
  assert.equal(chunks[3].choices[0].delta.tool_calls[0].function.arguments, '"a.ts"}');
  const last = chunks.at(-1);
  assert.equal(last.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(last.choices[0].delta, { content: "", role: "assistant" });
  assert.equal(last.usage.prompt_tokens, 100);
  assert.equal(last.usage.total_tokens, 120);
  assert.equal(last.usage.cost, 0.14);
  assert.equal(fake.keys()[0]?.spend, 0.14);
});

test("without stream, the chunks come back as one message", async () => {
  fake.completions("codeman/acme/app/1/7", () => stream(TOOL_CALL));
  const body = (await (await complete(false)).json()) as Json;
  assert.equal(body.object, "chat.completion");
  assert.deepEqual(body.choices[0].message, {
    role: "assistant",
    content: "Writing.",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "write", arguments: '{"path":"a.ts"}' } },
    ],
  });
  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.usage.completion_tokens, 20);
});

test("a whole reply streams as chunks too", async () => {
  const { data } = await events(await complete(true));
  assert.equal(data[0].choices[0].delta.content, "OK.");
  assert.equal(data[0].choices[0].finish_reason, "stop");
  assert.ok(data[1].usage.completion_tokens > 0);
  assert.equal(data[2], "[DONE]");
});

test("an error before the reply is an HTTP status; after, an SSE event", async () => {
  fake.completions(undefined, () => {
    throw new HttpError(502, { error: { code: 502, message: "Provider returned error" } });
  });
  const before = await complete(true);
  assert.equal(before.status, 502);
  assert.equal(((await before.json()) as Json).error.code, 502);

  fake.completions(undefined, () =>
    stream([
      { delta: { content: "Half" } },
      { error: { code: "server_error", message: "Provider disconnected unexpectedly" } },
    ]),
  );
  const during = await complete(true);
  assert.equal(during.status, 200);
  const { data } = await events(during);
  assert.equal(data.at(-1).error.message, "Provider disconnected unexpectedly");
  assert.equal(data.at(-1).choices[0].finish_reason, "error");
  assert.notEqual(data.at(-1), "[DONE]");
  // What was generated is still billed, estimated without usage.
  assert.ok((fake.keys()[0]?.spend ?? 0) > 0);
});
