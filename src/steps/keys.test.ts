import assert from "node:assert/strict";
import { test } from "node:test";
import { runTokens } from "./keys.ts";

/** A fake analytics API that answers each query with the next result. */
function analytics(results: ({ input: number; output: number } | undefined | Error)[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async keyTokens() {
      const result = results[Math.min(calls++, results.length - 1)];
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const noWait = async () => undefined;

test("asks again until analytics counts a key that spent something", async () => {
  const api = analytics([undefined, { input: 0, output: 0 }, { input: 1500, output: 40 }]);
  assert.deepEqual(await runTokens(api, "h", true, noWait), { input: 1500, output: 40 });
  assert.equal(api.calls, 3);
});

test("gives up after about a minute without tokens", async () => {
  const api = analytics([undefined]);
  assert.equal(await runTokens(api, "h", true, noWait), undefined);
  assert.equal(api.calls, 7);
});

test("a key that spent nothing used no tokens, without waiting", async () => {
  const api = analytics([undefined]);
  assert.deepEqual(await runTokens(api, "h", false, noWait), { input: 0, output: 0 });
  assert.equal(api.calls, 1);
});

test("a failed query leaves the tokens unknown, and does not fail the job", async () => {
  const api = analytics([new Error("OpenRouter POST /analytics/query failed with 403.")]);
  assert.equal(await runTokens(api, "h", true, noWait), undefined);
});
