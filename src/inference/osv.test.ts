import assert from "node:assert/strict";
import { test } from "node:test";
import { Osv, OsvUnavailable, OsvUnusable } from "./osv.ts";

type Call = { url: string; init: RequestInit };

function osv(
  answer: (url: string, init: RequestInit) => Response | Promise<Response>,
  limits = {},
): { client: Osv; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { client: new Osv(fetchFn, limits), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const vllm = (version: string) => ({ package: { ecosystem: "PyPI", name: "vllm" }, version });
const body = (call: Call | undefined) => JSON.parse(String(call?.init.body));

test("asks for many versions in one querybatch, and answers the IDs of each", async () => {
  const { client, calls } = osv(() =>
    json({
      results: [
        { vulns: [{ id: "GHSA-6757-hggm-hp2w", modified: "x" }, { id: "PYSEC-2026-4345" }] },
        {},
      ],
    }),
  );
  assert.deepEqual(await client.query([vllm("0.31.0"), vllm("0.32.0")]), [
    ["GHSA-6757-hggm-hp2w", "PYSEC-2026-4345"],
    [],
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.osv.dev/v1/querybatch");
  assert.equal(calls[0]?.init.method, "POST");
  assert.deepEqual(body(calls[0]), { queries: [vllm("0.31.0"), vllm("0.32.0")] });
});

test("splits the queries in batches, and follows the pages of only the queries that have more", async () => {
  const answers = [
    json({
      results: [{ vulns: [{ id: "A-1" }], next_page_token: "t1" }, { vulns: [{ id: "B-1" }] }],
    }),
    json({ results: [{ vulns: [{ id: "A-2" }] }] }),
    json({ results: [{ vulns: [{ id: "C-1" }] }] }),
  ];
  const { client, calls } = osv(() => answers.shift() ?? json({}, 500), { batchSize: 2 });
  assert.deepEqual(await client.query([vllm("1"), vllm("2"), vllm("3")]), [
    ["A-1", "A-2"],
    ["B-1"],
    ["C-1"],
  ]);
  assert.deepEqual(
    calls.map((call) => body(call).queries),
    [[vllm("1"), vllm("2")], [{ ...vllm("1"), page_token: "t1" }], [vllm("3")]],
  );
});

test("stops following pages at the cap, and refuses an answer of another shape", async () => {
  const paged = osv(() => json({ results: [{ vulns: [], next_page_token: "more" }] }), {
    maxPages: 3,
  });
  await assert.rejects(paged.client.query([vllm("1")]), OsvUnusable);
  assert.equal(paged.calls.length, 3);

  const short = osv(() => json({ results: [] }));
  await assert.rejects(short.client.query([vllm("1")]), (error) => {
    assert.ok(error instanceof OsvUnusable);
    assert.match(error.message, /0 results for 1 queries/);
    return true;
  });
  const badId = osv(() => json({ results: [{ vulns: [{ id: "../admin" }] }] }));
  await assert.rejects(badId.client.query([vllm("1")]), OsvUnusable);
});

test("reads each record once, at most `concurrency` at a time, leaving out the unknown", async () => {
  let inFlight = 0;
  let most = 0;
  const { client, calls } = osv(
    async (url) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      return id === "CVE-2026-39824" ? json({ code: 5 }, 404) : json({ id, summary: id });
    },
    { concurrency: 2 },
  );
  const ids = ["GO-2026-5024", "CVE-2026-39824", "GHSA-a", "GHSA-b", "GHSA-c", "GHSA-a"];
  const records = await client.records(ids);
  assert.deepEqual([...records.keys()], ["GO-2026-5024", "GHSA-a", "GHSA-b", "GHSA-c"]);
  assert.equal(records.get("GHSA-b")?.summary, "GHSA-b");
  assert.equal(calls.length, 5);
  assert.equal(most, 2);
  assert.equal(calls[0]?.url, "https://api.osv.dev/v1/vulns/GO-2026-5024");
  assert.equal(calls[0]?.init.method, "GET");
});

test("refuses more records than the cap, or an ID OSV does not serve, before any request", async () => {
  const { client, calls } = osv(() => json({ id: "x" }), { maxRecords: 2 });
  await assert.rejects(client.records(["A-1", "A-2", "A-3"]), /3 advisories .* cap of 2/);
  await assert.rejects(client.records(["A-1", "a/../b"]), OsvUnusable);
  assert.equal(calls.length, 0);
});

test("an outage and a refusal are told apart", async () => {
  const cases: [() => Response, typeof OsvUnavailable | typeof OsvUnusable, number | undefined][] =
    [
      [
        () => {
          throw new TypeError("fetch failed");
        },
        OsvUnavailable,
        undefined,
      ],
      [() => json({}, 503), OsvUnavailable, 503],
      [() => json({}, 429), OsvUnavailable, 429],
      [() => new Response("<html>gateway</html>", { status: 200 }), OsvUnavailable, 200],
      [() => json({ code: 3, message: "Invalid query." }, 400), OsvUnusable, 400],
      [() => json([1, 2]), OsvUnusable, undefined],
    ];
  for (const [answer, kind, status] of cases) {
    const { client } = osv(answer);
    await assert.rejects(client.query([vllm("1")]), (error) => {
      assert.ok(error instanceof kind, `${error}`);
      assert.equal((error as OsvUnavailable).status, status);
      return true;
    });
  }
  const { client } = osv(() => json({}, 500));
  await assert.rejects(client.records(["GHSA-a"]), /answered GET \/v1\/vulns\/GHSA-a with 500/);
});
