import assert from "node:assert/strict";
import { test } from "node:test";
import { runCost, runTokens, taskCosts } from "./keys.ts";

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

/** A fake key whose usage reads the next value each time. */
function usage(values: number[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async keyUsage() {
      return values[Math.min(calls++, values.length - 1)] ?? 0;
    },
  };
}

test("reads the usage until it stops changing", async () => {
  const api = usage([0.01, 0.03, 0.03]);
  assert.equal(await runCost(api, "h", false, noWait), 0.03);
  assert.equal(api.calls, 3);
});

test("a key that spent nothing is read twice", async () => {
  const api = usage([0]);
  assert.equal(await runCost(api, "h", false, noWait), 0);
  assert.equal(api.calls, 2);
});

test("a used key's zero usage is read again until the cost shows", async () => {
  const api = usage([0, 0, 0, 0.05, 0.05]);
  assert.equal(await runCost(api, "h", true, noWait), 0.05);
  assert.equal(api.calls, 5);
});

test("a used key's zero usage is read for about a minute at most", async () => {
  const api = usage([0]);
  assert.equal(await runCost(api, "h", true, noWait), 0);
  assert.equal(api.calls, 13);
});

/** A fake OpenRouter with the run's key and the account's keys. */
function keys(name: string, listed: { name: string; usage?: number }[] | Error) {
  return {
    async key() {
      return { hash: "h", name };
    },
    async listKeys() {
      if (listed instanceof Error) throw listed;
      return listed.map((key, index) => ({ hash: String(index), ...key }));
    },
  };
}

test("reads what each run of the key's task spent", async () => {
  process.env.GITHUB_REPOSITORY = "o/r";
  const api = keys("codeman/o/r/7/300", [
    { name: "codeman/o/r/7/100", usage: 0.05123 },
    { name: "codeman/o/r/7/200" },
    { name: "codeman/o/r/7/300", usage: 0.036 },
    { name: "codeman/o/r/70/400", usage: 1 },
    { name: "codeman/o/other/7/500", usage: 1 },
  ]);
  assert.deepEqual(await taskCosts(api, "h"), { "100": 0.0512, "200": 0, "300": 0.036 });
});

test("a key that is not a task key of this repository, or a failed listing, gives no costs", async () => {
  process.env.GITHUB_REPOSITORY = "o/r";
  assert.equal(await taskCosts(keys("codeman/o/other/7/300", []), "h"), undefined);
  assert.equal(await taskCosts(keys("codeman/o/r/300", []), "h"), undefined);
  const failed = keys("codeman/o/r/7/300", new Error("OpenRouter GET /keys failed with 500."));
  assert.equal(await taskCosts(failed, "h"), undefined);
});
