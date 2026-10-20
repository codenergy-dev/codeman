import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fixPrompt, OUTPUT_FILE, TASK_FILE } from "../../../src/prompt.ts";
import type { ChatRequest } from "../openrouter/chat.ts";
import { LlmFake } from "./llm.ts";
import { callId, type TurnLog, type Violation } from "./model.ts";
import { reply } from "./openai.ts";
import { accumulate, type Send, Session, sseEvents, taskFile, WORKDIR } from "./session.ts";

const SCENARIO = "happy-path/openrouter-to-done";

const SCRIPT = {
  i1: {
    plan: [
      {
        steps: [{ output: { summary: "Adds a route.", language: "en", decisions: [] } }],
      },
    ],
    code: [
      {
        usage: { prompt: 1200, completion: 300 },
        steps: [
          { write: { path: "src/health.ts", content: "export const ok = true;\n" } },
          {
            edit: {
              path: "src/index.ts",
              old: "// routes",
              new: "// routes\nhealth();",
              all: true,
            },
          },
          { bash: { command: "npm test", timeout: 60000 } },
          {
            output: {
              status: "done",
              summary: "Adds the route.",
              commitMessage: "Add a health route",
            },
          },
        ],
        fix: [{ output: { status: "done", summary: "Short." } }],
      },
      { steps: [{ raw: "not json" }] },
    ],
    review: [{ steps: ["exit"] }, { steps: [{ delay: 20 }, "hang"] }],
  },
};

const fake = new LlmFake({ models: ["e2e-model"] });
let origin = "";
before(async () => {
  origin = await fake.server.listen();
});
after(() => fake.server.close());
beforeEach(async () => {
  fake.server.reset();
  await control("PUT", `/scripts/${SCENARIO}`, SCRIPT);
});

function control(method: string, path: string, body?: unknown) {
  return fetch(`${origin}/_fake/llm${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function post(request: ChatRequest, signal?: AbortSignal) {
  return fetch(`${origin}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
}

/** Over HTTP, streamed, through an OpenAI-style accumulator. */
const streamed: Send = async (request) => {
  const response = await post(request);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  return accumulate(sseEvents(await response.text()));
};

/** Over HTTP, as one JSON body. */
const whole: Send = async (request) => {
  const response = await post({ ...request, stream: false, stream_options: undefined });
  assert.equal(response.status, 200);
  // biome-ignore lint/suspicious/noExplicitAny: the body is the fake's, read field by field.
  const body = (await response.json()) as any;
  const choice = body.choices[0];
  return {
    content: choice.message.content ?? "",
    calls: choice.message.tool_calls ?? [],
    finish: choice.finish_reason,
    usage: body.usage,
  };
};

const args = (session: Session) =>
  session.calls.map((call) => [call.function.name, JSON.parse(call.function.arguments)]);

test("a scripted round makes OpenCode's tool calls, then a final answer", async () => {
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  await session.run(streamed);
  assert.deepEqual(args(session), [
    ["read", { filePath: `${WORKDIR}/${TASK_FILE}` }],
    ["write", { content: "export const ok = true;\n", filePath: `${WORKDIR}/src/health.ts` }],
    [
      "edit",
      {
        filePath: `${WORKDIR}/src/index.ts`,
        oldString: "// routes",
        newString: "// routes\nhealth();",
        replaceAll: true,
      },
    ],
    ["bash", { command: "npm test", timeout: 60000 }],
    [
      "write",
      {
        content: `${JSON.stringify({ status: "done", summary: "Adds the route.", commitMessage: "Add a health route" }, null, 2)}\n`,
        filePath: `${WORKDIR}/${OUTPUT_FILE}`,
      },
    ],
  ]);
  const last = session.replies.at(-1);
  assert.deepEqual([last?.content, last?.finish], ["Done.", "stop"]);
  assert.deepEqual(
    session.replies.slice(1).map((received) => received.usage?.prompt_tokens),
    [1200, 1200, 1200, 1200, 1200],
  );
  assert.equal(session.replies[1]?.finish, "tool_calls");
  assert.equal(session.calls[1]?.id, callId(SCENARIO, "i1", "code", 0, "main", 1));
});

test("the same script yields the same tool calls each time, streamed or whole", async () => {
  const runs = [];
  for (const send of [streamed, whole, streamed]) {
    fake.server.reset();
    await control("PUT", `/scripts/${SCENARIO}`, SCRIPT);
    const session = new Session(taskFile(SCENARIO, "i1", "code"));
    await session.run(send);
    runs.push(session.calls);
  }
  assert.ok((runs[0]?.length ?? 0) > 1);
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);
});

test("the log names each turn's scenario, issue, stage, round, phase and turn", async () => {
  const session = new Session(taskFile(SCENARIO, "i1", "plan"));
  await session.run(streamed);
  const turns = (await (await control("GET", "/turns")).json()) as TurnLog[];
  assert.deepEqual(
    turns.map((turn) => [turn.kind, turn.stage, turn.round, turn.phase, turn.turn, turn.step]),
    [
      ["start", undefined, undefined, undefined, undefined, undefined],
      ["step", "plan", 0, "main", 1, "output"],
      ["final", "plan", 0, "main", 2, undefined],
    ],
  );
  assert.equal(turns[1]?.scenario, SCENARIO);
  assert.equal(turns[1]?.issue, "i1");
  assert.match(turns[1]?.lastResult ?? "", /# Codeman task: plan issue #12/);
  assert.match(turns[2]?.lastResult ?? "", /Wrote file successfully/);
});

test("the fix pass plays the round's fix steps; the next run is the next round", async () => {
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  await session.run(streamed);
  session.resume(fixPrompt(["summary is too long."]));
  const fixed = await session.run(streamed);
  assert.deepEqual(
    fixed.map((call) => JSON.parse(call.function.arguments).content),
    [`${JSON.stringify({ status: "done", summary: "Short." }, null, 2)}\n`],
  );

  const next = new Session(taskFile(SCENARIO, "i1", "code"));
  const calls = await next.run(streamed);
  assert.deepEqual(
    calls.at(-1)?.function.arguments,
    JSON.stringify({ content: "not json", filePath: `${WORKDIR}/${OUTPUT_FILE}` }),
  );

  // A third run of code: its first turn reads the task file, its second is not scripted.
  const third = new Session(taskFile(SCENARIO, "i1", "code"));
  await assert.rejects(third.run(streamed), /Unscripted request/);
  const violations = (await (await control("GET", "/violations")).json()) as Violation[];
  assert.equal(violations.length, 1);
  assert.match(violations[0]?.reason ?? "", /Round 2 of code is not scripted/);
  assert.deepEqual([violations[0]?.round, violations[0]?.turn], [2, 1]);
});

test("an unscripted request gets an error and is recorded", async () => {
  const unknown = new Session(taskFile("another/scenario", "i1", "plan"));
  await assert.rejects(unknown.run(streamed), /400/);
  const missing = new Session(taskFile(SCENARIO, "i2", "plan"));
  await assert.rejects(missing.run(streamed), /400/);
  const response = await post({ model: "m", messages: [{ role: "user", content: "Hi." }] });
  assert.equal(response.status, 400);
  // biome-ignore lint/suspicious/noExplicitAny: the body is the fake's.
  const body = (await response.json()) as any;
  assert.match(body.error.message, /Unscripted request/);
  const violations = (await (await control("GET", "/violations")).json()) as Violation[];
  assert.deepEqual(
    violations.map((violation) => violation.reason),
    [
      'No script for scenario "another/scenario".',
      "No plan rounds for issue i2.",
      "The last user message is not Codeman's harness prompt.",
    ],
  );
});

test("a step whose tool the request does not offer is a violation", async () => {
  const session = new Session(taskFile(SCENARIO, "i1", "code"), ["bash", "read", "apply_patch"]);
  await assert.rejects(session.run(streamed), /400/);
  const violations = (await (await control("GET", "/violations")).json()) as Violation[];
  assert.match(violations[0]?.reason ?? "", /no "write" tool/);
});

test("an exit step drops the connection mid-reply; a hang never ends until a reset", async () => {
  // Round 0 of review exits, round 1 hangs.
  const exits = new Session(taskFile(SCENARIO, "i1", "review"));
  await exits.step(streamed);
  const dropped = await post(exits.request());
  assert.equal(dropped.status, 200);
  await assert.rejects(dropped.text());

  const hangs = new Session(taskFile(SCENARIO, "i1", "review"));
  await hangs.step(streamed);
  const response = await post(hangs.request());
  assert.equal(response.status, 200);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"content":"Working"/);
  const pending = reader.read();
  const outcome = await Promise.race([
    pending.then(() => "ended"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 400)),
  ]);
  assert.equal(outcome, "pending");
  fake.server.reset();
  await assert.rejects(pending);
});

test("a hang ends when its client leaves", async () => {
  const exits = new Session(taskFile(SCENARIO, "i1", "review"));
  await exits.step(streamed);
  await post(exits.request())
    .then((response) => response.text())
    .catch(() => {});
  const hangs = new Session(taskFile(SCENARIO, "i1", "review"));
  await hangs.step(streamed);
  const abort = new AbortController();
  const response = await post(hangs.request(), abort.signal);
  abort.abort();
  await assert.rejects(response.text());
});

test("the reply works without a server, for a proxy such as the tee", async () => {
  const session = new Session(taskFile(SCENARIO, "i1", "plan"));
  const calls = await session.run(async (request) => {
    const wire = reply(fake.model, request, "tee");
    let text = "";
    for await (const part of wire.body) text += part;
    return accumulate(sseEvents(text));
  });
  assert.equal(calls.length, 2);
  assert.ok(fake.model.turns.every((turn) => turn.via === "tee"));
});

test("the control API checks scripts, lists models, and keeps file scripts across resets", async () => {
  const bad = await control("PUT", "/scripts/x", {
    i1: { code: [{ steps: [{ edit: { path: "a" } }] }] },
  });
  assert.equal(bad.status, 400);
  assert.match(
    ((await bad.json()) as { message: string }).message,
    /\$\.i1\.code\[0\]\.steps\[0\]\.edit\.old/,
  );
  assert.equal((await control("DELETE", "/scripts/x")).status, 404);
  const models = (await (await fetch(`${origin}/v1/models`)).json()) as { data: { id: string }[] };
  assert.deepEqual(
    models.data.map((model) => model.id),
    ["e2e-model"],
  );

  const withFile = new LlmFake({ scripts: { "from/file": SCRIPT } });
  withFile.model.load("api", {});
  withFile.server.reset();
  assert.deepEqual(Object.keys(withFile.model.scripts()), ["from/file"]);
});
