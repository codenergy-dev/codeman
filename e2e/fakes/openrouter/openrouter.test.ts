import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { OpenRouterFake } from "./openrouter.ts";

/** A JSON body, read loosely: each test checks the fields it needs. */
// biome-ignore lint/suspicious/noExplicitAny: the bodies are the fake's, checked field by field.
type Json = any;

const MANAGEMENT = "sk-or-v1-management-e2e";
let now = Date.parse("2026-10-20T12:00:00Z");
const fake = new OpenRouterFake({ managementKey: MANAGEMENT }, { now: () => now });
let origin = "";
before(async () => {
  origin = await fake.server.listen();
});
after(() => fake.server.close());
beforeEach(() => {
  fake.server.reset();
  now = Date.parse("2026-10-20T12:00:00Z");
});

async function call(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function createKey(body: Record<string, unknown> = {}) {
  const { status, body: created } = await call("/api/v1/keys", {
    method: "POST",
    token: MANAGEMENT,
    body: { name: "codeman/acme/app/1/7", limit: 1, expires_at: "2026-10-21T12:00:00Z", ...body },
  });
  assert.equal(status, 201);
  return created as { key: string; data: { hash: string } };
}

function chat(key: string, content = "Hello") {
  return call("/api/v1/chat/completions", {
    method: "POST",
    token: key,
    body: { model: "openai/gpt-4o", messages: [{ role: "user", content }] },
  });
}

test("the management API needs the management key, not a run's key", async () => {
  const { key } = await createKey();
  assert.equal((await call("/api/v1/keys")).status, 401);
  assert.deepEqual((await call("/api/v1/keys", { token: "sk-or-v1-other" })).body, {
    error: { code: 401, message: "User not found." },
  });
  const forbidden = await call("/api/v1/keys", { token: key });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, 403);
  assert.equal((await call("/api/v1/credits", { token: key })).status, 403);
});

test("a key is created with its name, limit and expiry, and listed until deleted", async () => {
  const { key, data } = await createKey();
  assert.match(key, /^sk-or-v1-[0-9a-f]{64}$/);
  assert.match(data.hash, /^[0-9a-f]{64}$/);
  const got = await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT });
  assert.equal(got.body.data.name, "codeman/acme/app/1/7");
  assert.equal(got.body.data.limit, 1);
  assert.equal(got.body.data.limit_remaining, 1);
  assert.equal(got.body.data.usage, 0);
  assert.equal(got.body.data.expires_at, "2026-10-21T12:00:00Z");
  assert.equal(got.body.data.disabled, false);

  const deleted = await call(`/api/v1/keys/${data.hash}`, { method: "DELETE", token: MANAGEMENT });
  assert.deepEqual(deleted.body, { deleted: true });
  assert.equal((await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT })).status, 404);
  assert.equal((await chat(key)).status, 401);
});

test("an expiry needs seconds and a name is required", async () => {
  for (const body of [{ expires_at: "2026-10-21T12:00Z" }, { name: "" }]) {
    const { status } = await call("/api/v1/keys", {
      method: "POST",
      token: MANAGEMENT,
      body: { name: "k", ...body },
    });
    assert.equal(status, 400);
  }
});

test("a disabled key is listed only with include_disabled and answers 401", async () => {
  const { key, data } = await createKey();
  await createKey({ name: "codeman/acme/app/1/8" });
  const patched = await call(`/api/v1/keys/${data.hash}`, {
    method: "PATCH",
    token: MANAGEMENT,
    body: { disabled: true },
  });
  assert.equal(patched.body.data.disabled, true);
  const names = async (query: string) =>
    (await call(`/api/v1/keys${query}`, { token: MANAGEMENT })).body.data.map(
      (k: { name: string }) => k.name,
    );
  assert.deepEqual(await names(""), ["codeman/acme/app/1/8"]);
  assert.deepEqual(await names("?include_disabled=true&offset=0"), [
    "codeman/acme/app/1/7",
    "codeman/acme/app/1/8",
  ]);
  assert.deepEqual(await names("?include_disabled=true&offset=2"), []);
  assert.equal((await chat(key)).status, 401);
});

test("an expired key answers 401", async () => {
  const { key } = await createKey({ expires_at: "2026-10-20T13:00:00Z" });
  assert.equal((await chat(key)).status, 200);
  now = Date.parse("2026-10-20T13:00:00Z");
  assert.equal((await chat(key)).status, 401);
});

test("a completion bills the key at the token prices", async () => {
  fake.prices({ prompt: 0.001, completion: 0.002 });
  fake.completions(undefined, () => ({
    message: { content: "Hi" },
    finish_reason: "stop",
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  }));
  const { key, data } = await createKey();
  const { status, body } = await chat(key);
  assert.equal(status, 200);
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].message.content, "Hi");
  assert.equal(body.usage.cost, 0.2);
  const got = await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT });
  assert.equal(got.body.data.usage, 0.2);
  assert.equal(Number(got.body.data.limit_remaining.toFixed(6)), 0.8);
  const current = await call("/api/v1/key", { token: key });
  assert.equal(current.body.data.usage, 0.2);
  assert.equal(current.body.data.is_management_key, false);
});

test("usage and analytics appear only after their lags", async () => {
  fake.lags({ usageMs: 90_000, analyticsMs: 10_000 });
  const { key, data } = await createKey();
  assert.equal((await chat(key)).status, 200);
  const usage = async () =>
    (await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT })).body.data.usage;
  const rows = async () =>
    (
      await call("/api/v1/analytics/query", {
        method: "POST",
        token: MANAGEMENT,
        body: {
          metrics: ["tokens_prompt", "tokens_completion"],
          filters: [{ field: "api_key_id", operator: "eq", value: data.hash }],
          time_range: { start: "2026-10-19T12:00:00Z", end: "2026-10-20T13:00:00Z" },
        },
      })
    ).body.data.data;

  assert.equal(await usage(), 0);
  assert.deepEqual(await rows(), []);
  now += 10_000;
  // The 0-cost case: analytics has the tokens, the key's usage does not show their cost yet.
  assert.equal(await usage(), 0);
  assert.equal((await rows()).length, 1);
  assert.ok((await rows())[0].tokens_completion > 0);
  now += 80_000;
  assert.ok((await usage()) > 0);
  // What the control API tells: the real spend all along.
  assert.equal(fake.keys()[0]?.usage, await usage());
});

test("a held lag shows usage only once the scenario settles it", async () => {
  fake.lags({ usageMs: null });
  const { key, data } = await createKey();
  await chat(key);
  now += 3_600_000;
  const state = await call("/_fake/openrouter/keys");
  assert.equal(state.body[0].usage, 0);
  assert.ok(state.body[0].spend > 0);
  assert.equal((await call("/_fake/openrouter/settle", { method: "POST" })).status, 204);
  const got = await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT });
  assert.equal(got.body.data.usage, state.body[0].spend);
});

test("a spent key answers 402, even while its usage lags", async () => {
  fake.lags({ usageMs: null });
  fake.prices({ prompt: 0.01, completion: 0.01 });
  const { key, data } = await createKey({ limit: 0.05 });
  assert.equal((await chat(key, "x".repeat(40))).status, 200);
  const spent = await chat(key);
  assert.equal(spent.status, 402);
  assert.equal(spent.body.error.code, 402);
  assert.equal(spent.body.error.metadata.limit_source, "openrouter_key_limit");
  const got = await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT });
  assert.equal(got.body.data.usage, 0);

  // Raising the limit lets it go on.
  await call(`/api/v1/keys/${data.hash}`, {
    method: "PATCH",
    token: MANAGEMENT,
    body: { limit: 10 },
  });
  assert.equal((await chat(key)).status, 200);
});

test("the control API sets a key's usage, which a limit then counts", async () => {
  const { key, data } = await createKey({ limit: 1 });
  const set = await call(`/_fake/openrouter/keys/${data.hash}/usage`, {
    method: "PUT",
    body: { usage: 1 },
  });
  assert.equal(set.status, 204);
  const got = await call(`/api/v1/keys/${data.hash}`, { token: MANAGEMENT });
  assert.equal(got.body.data.usage, 1);
  assert.equal(got.body.data.limit_remaining, 0);
  assert.equal((await chat(key)).status, 402);
  const credits = await call("/api/v1/credits", { token: MANAGEMENT });
  assert.deepEqual(credits.body, { data: { total_credits: 100, total_usage: 1 } });
});

test("the control API sets the reply per key name", async () => {
  const seven = await createKey();
  const eight = await createKey({ name: "codeman/acme/app/1/8" });
  const set = await call("/_fake/openrouter/completions", {
    method: "PUT",
    body: { name: "codeman/acme/app/1/8", text: "Eight." },
  });
  assert.equal(set.status, 204);
  assert.equal((await chat(seven.key)).body.choices[0].message.content, "OK.");
  assert.equal((await chat(eight.key)).body.choices[0].message.content, "Eight.");
  const lags = await call("/_fake/openrouter/lags", { method: "PUT", body: { usageMs: "soon" } });
  assert.equal(lags.status, 400);
});

test("analytics answers per generation, largest prompt first", async () => {
  const { key, data } = await createKey();
  await chat(key, "short");
  await chat(key, "a much longer prompt than the first one");
  const answer = async (body: unknown) =>
    call("/api/v1/analytics/query", { method: "POST", token: MANAGEMENT, body });
  const filters = [{ field: "api_key_id", operator: "eq", value: data.hash }];
  const time_range = { start: "2026-10-19T12:00:00Z", end: "2026-10-20T12:00:00Z" };
  const stats = await answer({ metrics: ["request_count", "avg_throughput"], filters, time_range });
  assert.equal(stats.body.data.data[0].request_count, 2);
  assert.equal(stats.body.data.data[0].avg_throughput, 50);
  const largest = await answer({
    metrics: ["tokens_prompt"],
    dimensions: ["generation_id"],
    filters,
    time_range,
    order_by: { field: "tokens_prompt", direction: "desc" },
    limit: 1,
  });
  assert.equal(largest.body.data.data.length, 1);
  assert.equal(largest.body.data.metadata.truncated, true);
  const generations = (await call("/_fake/openrouter/generations")).body as {
    promptTokens: number;
  }[];
  const prompts = generations.map((generation) => generation.promptTokens);
  assert.equal(largest.body.data.data[0].tokens_prompt, Math.max(...prompts));
  assert.ok(prompts[0] !== prompts[1]);
  const minutes = { start: "2026-10-19T12:00Z", end: "2026-10-20T12:00Z" };
  assert.equal((await answer({ metrics: ["tokens_prompt"], time_range: minutes })).status, 400);
  assert.equal((await answer({ metrics: ["no_such_metric"] })).status, 400);
});

test("faults come from the shared module", async () => {
  const { key } = await createKey();
  fake.server.fault({ path: "/api/v1/chat/completions", status: 503, times: 1 });
  assert.equal((await chat(key)).status, 503);
  assert.equal((await chat(key)).status, 200);
});

test("the control API sets the account's credits until a reset, and spent credits answer 402", async () => {
  const { key, data } = await createKey({ limit: 10 });
  assert.equal(
    (await call("/_fake/openrouter/credits", { method: "PUT", body: { credits: "a lot" } })).status,
    400,
  );
  const set = await call("/_fake/openrouter/credits", { method: "PUT", body: { credits: 0.5 } });
  assert.equal(set.status, 204);
  const credits = await call("/api/v1/credits", { token: MANAGEMENT });
  assert.equal(credits.body.data.total_credits, 0.5);
  await call(`/_fake/openrouter/keys/${data.hash}/usage`, { method: "PUT", body: { usage: 0.5 } });
  const spent = await chat(key);
  assert.equal(spent.status, 402);
  assert.equal(spent.body.error.metadata.limit_source, "openrouter_credits");

  fake.server.reset();
  const after = await call("/api/v1/credits", { token: MANAGEMENT });
  assert.equal(after.body.data.total_credits, 100);
});
