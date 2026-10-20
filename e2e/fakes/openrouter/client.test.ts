import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { OpenRouter, runCost } from "../../../src/inference/openrouter.ts";
import { OpenRouterFake } from "./openrouter.ts";

/** Codeman's own OpenRouter client, its `fetch` redirected as the e2e build does, on the fake. */
const MANAGEMENT = "sk-or-v1-management-e2e";
let now = Date.now();
const fake = new OpenRouterFake({ managementKey: MANAGEMENT }, { now: () => now });
let origin = "";
let router: OpenRouter;
before(async () => {
  origin = await fake.server.listen();
  const { fetch } = redirects({ CODEMAN_E2E_ENDPOINTS: JSON.stringify({ openRouter: origin }) });
  router = new OpenRouter(MANAGEMENT, fetch);
});
after(() => fake.server.close());
beforeEach(() => {
  fake.server.reset();
  now = Date.now();
});

async function chat(key: string): Promise<number> {
  const response = await fetch(`${origin}/api/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "Plan the task." }],
    }),
  });
  await response.text();
  return response.status;
}

test("Codeman creates a key, reads its usage, tokens and stats, and disables it", async () => {
  const name = "codeman/acme/app/1/7";
  const expiresAt = `${new Date(now + 86_400_000).toISOString().slice(0, 19)}Z`;
  const { key, hash } = await router.createKey({ name, limit: 1.5, expiresAt });
  assert.equal(await chat(key), 200);

  const usage = await router.keyUsage(hash);
  assert.ok(usage > 0);
  const since = new Date(now - 3_600_000);
  const until = new Date(now + 1000);
  const tokens = await router.keyTokens(hash, since, until);
  assert.ok(tokens && tokens.input > 0 && tokens.output > 0);
  const stats = await router.keyStats(hash, since, until);
  assert.equal(stats?.requests, 1);
  assert.equal(stats?.tokensPerSecond, 50);
  assert.equal(stats?.maxInputTokens, tokens.input);

  await router.disableKey(hash);
  assert.equal(await chat(key), 401);
  const keys = await router.listKeys();
  assert.deepEqual(
    keys.map((k) => [k.name, k.usage]),
    [[name, usage]],
  );
  assert.equal((await router.key(hash)).name, name);
});

test("runCost reads a lagging cost until OpenRouter shows it", async () => {
  fake.lags({ usageMs: 20_000 });
  const expiresAt = `${new Date(now + 86_400_000).toISOString().slice(0, 19)}Z`;
  const { key, hash } = await router.createKey({
    name: "codeman/acme/app/1/8",
    limit: 1,
    expiresAt,
  });
  await chat(key);
  assert.equal(await router.keyUsage(hash), 0);
  const wait = async (ms: number) => {
    now += ms;
  };
  const cost = await runCost(router, hash, true, wait);
  assert.equal(cost, fake.keys()[0]?.spend);
  assert.ok(cost > 0);
});

test("a failure reports its status, as Codeman's client does with OpenRouter", async () => {
  fake.server.fault({ path: "/api/v1/keys/{hash}", method: "PATCH", status: 500 });
  await assert.rejects(router.disableKey("abc"), /PATCH \/keys\/abc failed with 500/);
});
