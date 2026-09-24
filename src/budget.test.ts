import assert from "node:assert/strict";
import { test } from "node:test";
import { expiresAt, type Fetch, keyPrefix, OpenRouter } from "./budget.ts";

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
