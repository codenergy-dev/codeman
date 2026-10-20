import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { OpenRouterFake } from "../openrouter/openrouter.ts";
import { openAiBackend, type QueueBackend } from "../runpod/serverless.ts";
import { LlmFake } from "./llm.ts";
import { completions, queueBackend, remoteCompletions } from "./openai.ts";
import { scriptOf } from "./script.ts";
import { accumulate, type Send, Session, sseEvents, taskFile } from "./session.ts";

const SCENARIO = "paths/three";
const SCRIPT = {
  i1: {
    code: [
      {
        usage: { prompt: 1000, completion: 100 },
        steps: [
          { write: { path: "a.ts", content: "export {};\n" } },
          { bash: "npm test" },
          { output: { status: "done", summary: "Adds a.ts." } },
        ],
      },
    ],
  },
};

const MANAGEMENT = "sk-or-v1-management-e2e";
const llm = new LlmFake();
const openRouter = new OpenRouterFake({
  managementKey: MANAGEMENT,
  prices: { prompt: 0.001, completion: 0.002 },
});
let llmOrigin = "";
let openRouterOrigin = "";
let key = "";
before(async () => {
  llmOrigin = await llm.server.listen();
  openRouterOrigin = await openRouter.server.listen();
});
after(async () => {
  await llm.server.close();
  await openRouter.server.close();
});
beforeEach(async () => {
  llm.server.reset();
  openRouter.server.reset();
  llm.model.load(SCENARIO, scriptOf(SCRIPT));
  const response = await fetch(`${openRouterOrigin}/api/v1/keys`, {
    method: "POST",
    headers: { authorization: `Bearer ${MANAGEMENT}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "codeman/acme/app/1/7", limit: 10 }),
  });
  key = ((await response.json()) as { key: string }).key;
});

/** Through the fake OpenRouter, as OpenCode's `openrouter` provider sends. */
const viaOpenRouter: Send = async (request) => {
  const response = await fetch(`${openRouterOrigin}/api/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return accumulate(sseEvents(await response.text()));
};

/** Through a Runpod queue worker: each output is one SSE event. */
function viaQueue(backend: QueueBackend): Send {
  return async (request) => {
    const outputs: unknown[] = [];
    const job = {
      id: "job-1",
      endpoint: "e2e",
      input: { openai_route: "/v1/chat/completions", openai_input: request },
      env: {},
    };
    for await (const output of backend.run(job, new AbortController().signal)) {
      outputs.push(output);
    }
    return accumulate(outputs.flatMap((output) => sseEvents(output as string)));
  };
}

async function direct(): Promise<unknown[]> {
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  return session.run(async (request) => {
    const response = await fetch(`${llmOrigin}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return accumulate(sseEvents(await response.text()));
  });
}

async function reset() {
  llm.server.reset();
  llm.model.load(SCENARIO, scriptOf(SCRIPT));
}

test("the fake OpenRouter answers with the script, in-process, and bills its usage", async () => {
  const expected = await direct();
  await reset();
  openRouter.completions(undefined, completions(llm.model));
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  assert.deepEqual(await session.run(viaOpenRouter), expected);
  assert.ok(llm.model.turns.every((turn) => turn.via === "openrouter"));
  assert.deepEqual(
    session.replies.slice(1).map((received) => received.usage?.prompt_tokens),
    [1000, 1000, 1000, 1000],
  );
  const generations = (await (
    await fetch(`${openRouterOrigin}/_fake/openrouter/generations`)
  ).json()) as { promptTokens: number; completionTokens: number }[];
  assert.deepEqual(
    generations.slice(1).map((generation) => generation.promptTokens),
    [1000, 1000, 1000, 1000],
  );
});

test("the fake OpenRouter answers with the script from the model's server", async () => {
  const expected = await direct();
  await reset();
  openRouter.completions(undefined, remoteCompletions(llmOrigin));
  const session = new Session(taskFile(SCENARIO, "i1", "code"));
  assert.deepEqual(await session.run(viaOpenRouter), expected);
});

test("an unscripted request is an error through the fake OpenRouter", async () => {
  openRouter.completions(undefined, completions(llm.model));
  const session = new Session(taskFile("nobody", "i1", "code"));
  await session.step(viaOpenRouter);
  const response = await fetch(`${openRouterOrigin}/api/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(session.request()),
  });
  assert.equal(response.status, 400);
  assert.equal(llm.model.violations.length, 1);
});

test("a Runpod queue worker plays the script, over HTTP or in-process", async () => {
  const expected = await direct();
  for (const backend of [openAiBackend(llmOrigin), queueBackend(llm.model, llm.models)]) {
    await reset();
    const session = new Session(taskFile(SCENARIO, "i1", "code"));
    assert.deepEqual(await session.run(viaQueue(backend)), expected);
  }
  const models: unknown[] = [];
  for await (const output of queueBackend(llm.model, llm.models).run(
    { id: "j", endpoint: "e", input: { openai_route: "/v1/models" }, env: {} },
    new AbortController().signal,
  )) {
    models.push(output);
  }
  assert.deepEqual(models, [
    {
      object: "list",
      data: [{ id: "e2e-model", object: "model", created: 0, owned_by: "codeman-e2e" }],
    },
  ]);
});
