import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYOUT } from "../store/layout.ts";
import { MemoryStore } from "../store/memory.ts";
import { FakeOsv, TEST_ENGINES, TEST_NODE } from "../testing/fake-releases.ts";
import { checkReleases, releaseCheckKey } from "./release-policy.ts";
import { StoredReleaseChecks } from "./resolution.ts";

const ollama = TEST_ENGINES.ollama as NonNullable<typeof TEST_ENGINES.ollama>;
const artifacts = [ollama.release, TEST_NODE.release];

test("passing checks are kept in the backend, by their key, and stand in for OSV.dev for 24 hours", async () => {
  const store = new MemoryStore();
  const cache = new StoredReleaseChecks(store);
  const osv = new FakeOsv();
  const at = new Date("2026-10-03T12:00:00Z");
  const live = await checkReleases(artifacts, { now: at, exceptions: [], osv, cache });
  assert.equal(live.verdict, "pass");
  const stored = await store.get(LAYOUT.releaseCheck(releaseCheckKey(artifacts, [])));
  assert.deepEqual(
    { ...stored?.fields, result: undefined },
    {
      releases: ["ollama 0.40.10", "node 24.22.1"],
      verdict: "pass",
      checkedAt: at,
      result: undefined,
    },
  );
  assert.deepEqual(await cache.get(releaseCheckKey(artifacts, [])), live);

  // Another job, with OSV.dev down: the backend's check stands, then expires.
  osv.down = true;
  const later = new StoredReleaseChecks(store);
  const soon = new Date("2026-10-04T11:00:00Z");
  const cached = await checkReleases(artifacts, { now: soon, exceptions: [], osv, cache: later });
  assert.deepEqual(
    [cached.verdict, cached.source, cached.cachedFrom],
    ["warn", "cache", at.toISOString()],
  );
  const late = new Date("2026-10-04T12:00:01Z");
  const stale = await checkReleases(artifacts, { now: late, exceptions: [], osv, cache: later });
  assert.equal(stale.verdict, "block");
  // A check from the cache is not written again: its 24 hours run from the live one.
  assert.equal(
    (
      await store.get(LAYOUT.releaseCheck(releaseCheckKey(artifacts, [])))
    )?.fields.checkedAt?.valueOf(),
    at.valueOf(),
  );
});

test("a document that cannot be read is no check: the policy then stops", async () => {
  const store = new MemoryStore();
  const key = releaseCheckKey(artifacts, []);
  await store.write([{ op: "set", path: LAYOUT.releaseCheck(key), fields: { result: "{" } }]);
  const osv = new FakeOsv();
  osv.down = true;
  const check = await checkReleases(artifacts, {
    now: new Date("2026-10-03T12:00:00Z"),
    exceptions: [],
    osv,
    cache: new StoredReleaseChecks(store),
  });
  assert.equal(check.verdict, "block");
});
