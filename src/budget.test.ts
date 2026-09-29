import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expiresAt,
  type Fetch,
  keyPrefix,
  OpenRouter,
  runLimit,
  sumUsage,
  taskKeyPrefix,
  usd,
} from "./budget.ts";

function fakeFetch(responses: unknown[]): { fetch: Fetch; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const body = responses.shift();
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as Fetch;
  return { fetch: fetchFn, calls };
}

test("formats expiry as OpenRouter expects", () => {
  assert.equal(expiresAt(new Date("2026-09-24T10:20:30.456Z"), 24), "2026-09-25T10:20:30Z");
});

test("adds up this month's usage of the repository's keys, across pages", async () => {
  const prefix = keyPrefix("org", "repo");
  const { fetch, calls } = fakeFetch([
    {
      data: [
        { hash: "1", name: `${prefix}1/100`, usage_monthly: 1.5 },
        { hash: "2", name: "codeman/org/repo-other/1/1", usage_monthly: 9 },
        { hash: "3", name: "personal", usage_monthly: 9 },
      ],
    },
    { data: [{ hash: "4", name: `${prefix}2/101`, usage_monthly: 0.25 }] },
    { data: [] },
  ]);
  assert.equal(await new OpenRouter("mk", fetch).monthlyUsage(prefix), 1.75);
  assert.deepEqual(
    calls.map(([url]) => url.replace("https://openrouter.ai/api/v1", "")),
    [
      "/keys?include_disabled=true&offset=0",
      "/keys?include_disabled=true&offset=3",
      "/keys?include_disabled=true&offset=4",
    ],
  );
  assert.equal(new Headers(calls[0]?.[1].headers).get("authorization"), "Bearer mk");
});

test("creates a limited, expiring key", async () => {
  const { fetch, calls } = fakeFetch([{ key: "sk-or-v1-x", data: { hash: "h", name: "n" } }]);
  const created = await new OpenRouter("mk", fetch).createKey({
    name: "codeman/o/r/1/2",
    limit: 2,
    expiresAt: "2026-09-25T10:00:00Z",
  });
  assert.deepEqual(created, { key: "sk-or-v1-x", hash: "h" });
  assert.equal(calls[0]?.[1].method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.[1].body)), {
    name: "codeman/o/r/1/2",
    limit: 2,
    expires_at: "2026-09-25T10:00:00Z",
  });
});

test("disables keys instead of deleting them", async () => {
  const { fetch, calls } = fakeFetch([{ data: {} }]);
  await new OpenRouter("mk", fetch).disableKey("abc");
  assert.equal(calls[0]?.[0], "https://openrouter.ai/api/v1/keys/abc");
  assert.equal(calls[0]?.[1].method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0]?.[1].body)), { disabled: true });
});

test("reports failures without echoing the response", async () => {
  const { fetch } = fakeFetch([new Response("secret echo", { status: 401 })]);
  await assert.rejects(new OpenRouter("mk", fetch).disableKey("abc"), (error: Error) => {
    assert.match(error.message, /failed with 401/);
    assert.ok(!error.message.includes("secret echo"));
    return true;
  });
});

test("adds up a task's spend without mixing tasks that share a prefix", () => {
  const keys = [
    { hash: "1", name: "codeman/o/r/1/100", usage: 0.2, usage_monthly: 0.2 },
    { hash: "2", name: "codeman/o/r/1/101", usage: 0.35 },
    { hash: "3", name: "codeman/o/r/12/102", usage: 5 },
    { hash: "4", name: "codeman/o/r2/1/103", usage: 5 },
  ];
  assert.equal(sumUsage(keys, taskKeyPrefix("o", "r", 1), "usage"), 0.55);
  assert.equal(sumUsage(keys, taskKeyPrefix("o", "r", 12), "usage"), 5);
  assert.equal(sumUsage(keys, keyPrefix("o", "r"), "usage_monthly"), 0.2);
});

test("a run gets what remains of the task budget, in cents rounded down", () => {
  assert.equal(runLimit(2, 0), 2);
  assert.equal(runLimit(2, 0.2), 1.8);
  assert.equal(runLimit(2, 0.2345), 1.76);
  assert.equal(runLimit(2, 1.9), 0.1);
  assert.equal(runLimit(2, 1.95), undefined, "below the floor");
  assert.equal(runLimit(2, 2.3), undefined, "overspent");
  assert.equal(usd(1.8), "US$ 1.80");
});

test("reads one key's total usage", async () => {
  const { fetch, calls } = fakeFetch([{ data: { hash: "h/x", name: "n", usage: 0.42 } }]);
  assert.equal(await new OpenRouter("mk", fetch).keyUsage("h/x"), 0.42);
  assert.equal(calls[0]?.[0], "https://openrouter.ai/api/v1/keys/h%2Fx");
});

test("reads a key's tokens from analytics, summing rows given as strings", async () => {
  const { fetch, calls } = fakeFetch([
    {
      data: {
        data: [
          { tokens_prompt: "1200", tokens_completion: 30 },
          { tokens_prompt: 800, tokens_completion: "20", other: "x" },
        ],
        metadata: { row_count: 2, truncated: false },
      },
    },
  ]);
  const tokens = await new OpenRouter("mk", fetch).keyTokens(
    "a".repeat(64),
    new Date("2026-09-27T10:00:00.123Z"),
    new Date("2026-09-28T10:00:00.456Z"),
  );
  assert.deepEqual(tokens, { input: 2000, output: 50 });
  const [url, init] = calls[0] ?? [];
  assert.equal(url, "https://openrouter.ai/api/v1/analytics/query");
  assert.equal(init?.method, "POST");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    metrics: ["tokens_prompt", "tokens_completion"],
    filters: [{ field: "api_key_id", operator: "eq", value: "a".repeat(64) }],
    time_range: { start: "2026-09-27T10:00:00Z", end: "2026-09-28T10:00:00Z" },
  });
});

test("a key with no analytics rows yet has no tokens", async () => {
  const { fetch } = fakeFetch([{ data: { data: [], metadata: { row_count: 0 } } }]);
  assert.equal(await new OpenRouter("mk", fetch).keyTokens("h", new Date(), new Date()), undefined);
});
