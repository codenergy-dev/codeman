import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  type AdvisoryDatabase,
  type OsvQuery,
  type OsvRecord,
  OsvUnavailable,
  OsvUnusable,
} from "./osv.ts";
import {
  type AdvisoryException,
  checkReleases,
  compareVersions,
  cvss3,
  fixesFor,
  MemoryReleaseCheckCache,
  type ReleaseArtifact,
  type ReleaseCheckCache,
  releaseCheckKey,
} from "./release-policy.ts";

// Records served by OSV.dev on 2026-10-30, trimmed to the fields Codeman reads. They come from
// GitHub's, PyPA's and Go's advisory databases, which publish them under CC-BY 4.0. The batches
// below are what OSV.dev's querybatch answered for each version (E3 of the investigation of
// multi-service pods), cut to these records.
const RECORDS: Record<string, OsvRecord> = JSON.parse(
  readFileSync(join(import.meta.dirname, "osv-fixtures.json"), "utf8"),
);

const BATCHES: Record<string, string[]> = {
  "PyPI vllm 0.31.0": [
    "GHSA-542m-9234-8gvf",
    "GHSA-6757-hggm-hp2w",
    "GHSA-h3rc-j82p-2c3h",
    "PYSEC-2026-4319",
    "PYSEC-2026-4345",
    "PYSEC-2026-4346",
  ],
  "PyPI vllm 0.32.0": [],
  "PyPI vllm 0.32.1": [],
  "Go github.com/ollama/ollama 0.35.1": ["GO-2025-3557", "GO-2025-4251"],
  "Go golang.org/x/sys 0.37.0": ["GO-2026-5024"],
};

/** OSV.dev, from the fixtures; `fail` makes every call throw it instead. */
function database(fail?: Error): AdvisoryDatabase & { queries: OsvQuery[]; reads: string[] } {
  const queries: OsvQuery[] = [];
  const reads: string[] = [];
  return {
    queries,
    reads,
    async query(asked) {
      if (fail) throw fail;
      queries.push(...asked);
      return asked.map((q) => {
        const ids = BATCHES[`${q.package.ecosystem} ${q.package.name} ${q.version}`];
        assert.ok(ids, `no batch for ${JSON.stringify(q)}`);
        return ids;
      });
    },
    async records(ids) {
      if (fail) throw fail;
      reads.push(...ids);
      return new Map(ids.flatMap((id) => (RECORDS[id] ? [[id, RECORDS[id]] as const] : [])));
    },
  };
}

const NOW = new Date("2026-10-30T12:00:00Z");
const days = (n: number, from = NOW) => new Date(from.getTime() - n * 86_400_000).toISOString();

const vllm = (version: string, publishedAt: string, more: Partial<ReleaseArtifact> = {}) => ({
  name: "vllm",
  version,
  publishedAt,
  osv: { ecosystem: "PyPI", package: "vllm" },
  ...more,
});
const ollama: ReleaseArtifact = {
  name: "docker.io/ollama/ollama",
  version: "0.35.1",
  publishedAt: "2026-10-02T17:10:52Z",
  osv: { ecosystem: "Go", package: "github.com/ollama/ollama" },
};
const node: ReleaseArtifact = {
  name: "node",
  version: "24.22.1",
  publishedAt: "2026-10-21T00:00:00Z",
};

function check(
  artifacts: ReleaseArtifact[],
  options: {
    now?: Date;
    exceptions?: AdvisoryException[];
    osv?: AdvisoryDatabase;
    cache?: ReleaseCheckCache;
  } = {},
) {
  return checkReleases(artifacts, {
    now: options.now ?? NOW,
    exceptions: options.exceptions ?? [],
    osv: options.osv ?? database(),
    cache: options.cache ?? new MemoryReleaseCheckCache(),
  });
}

const texts = (reasons: { level: string; text: string }[], level: string) =>
  reasons.filter((r) => r.level === level).map((r) => r.text);

test("vLLM 0.31.0 is blocked by its 2 high advisories, each pointing to its fix", async () => {
  const result = await check([vllm("0.31.0", "2026-10-03T08:06:44Z")]);
  assert.equal(result.verdict, "block");
  const [artifact] = result.artifacts;
  assert.equal(artifact?.verdict, "block");
  assert.equal(artifact?.ageDays, 27.16);
  assert.deepEqual(
    artifact?.advisories.map((a) => [a.id, a.severity, a.fixed]),
    [
      ["GHSA-6757-hggm-hp2w", "high", ["0.32.0"]],
      ["GHSA-h3rc-j82p-2c3h", "high", ["0.32.0"]],
      ["GHSA-542m-9234-8gvf", "moderate", ["0.32.0"]],
      ["PYSEC-2026-4319", "unknown", ["0.32.0"]],
    ],
  );
  // Each PYSEC record is taken as one with the GHSA it aliases.
  assert.deepEqual(artifact?.advisories[0]?.aliases, ["CVE-2026-115912", "PYSEC-2026-4345"]);
  // GitHub's reviewed severity stands over the 9.8 computed from PYSEC-2026-4346's vector.
  assert.equal(artifact?.advisories[1]?.severityFrom, "GHSA-h3rc-j82p-2c3h database_specific");
  const blocks = texts(result.reasons, "block");
  assert.equal(blocks.length, 2);
  assert.match(
    blocks[0] ?? "",
    /^vllm 0\.31\.0: it has GHSA-6757-hggm-hp2w \(high, also CVE-2026-115912, PYSEC-2026-4345\): vLLM: Public multimodal SHM.*It is fixed in 0\.32\.0; pin that release, or add an exception for GHSA-6757-hggm-hp2w with its reason\.$/,
  );
  assert.match(blocks[1] ?? "", /GHSA-h3rc-j82p-2c3h \(high/);
  const warnings = texts(result.reasons, "warning");
  assert.match(warnings[0] ?? "", /GHSA-542m-9234-8gvf \(moderate/);
  // A CVSS 4.0 vector alone is not scored, so it is a warning that says so.
  assert.match(
    warnings[1] ?? "",
    /PYSEC-2026-4319 \(no severity.*Its CVSS_V4 vector is not one Codeman scores, and none of its aliases has one, so review it by hand/,
  );
});

test("vLLM 0.32.0, under 7 days old, passes when it replaces 0.31.0, as its earliest fix", async () => {
  const now = new Date("2026-10-22T10:03:29Z");
  const published = "2026-10-18T10:03:29Z";
  const osv = database();
  const result = await check([vllm("v0.32.0", published, { replaces: "v0.31.0" })], { now, osv });
  assert.equal(result.verdict, "pass");
  const [artifact] = result.artifacts;
  assert.equal(artifact?.ageDays, 4);
  assert.deepEqual(artifact?.bypass, { replaces: "v0.31.0", advisory: "GHSA-6757-hggm-hp2w" });
  assert.deepEqual(texts(result.reasons, "note"), [
    "vllm v0.32.0: it was published 4 days ago, under the minimum age of 7 days, but passes: it is the earliest release that fixes GHSA-6757-hggm-hp2w (high) of v0.31.0, which it replaces.",
  ]);
  // OSV's versions carry no "v"; both versions go in one batch.
  assert.deepEqual(
    osv.queries.map((q) => q.version),
    ["0.32.0", "0.31.0"],
  );

  // Without `replaces`, or as a later release than the earliest fix, it waits.
  const alone = await check([vllm("0.32.0", published)], { now });
  assert.equal(alone.verdict, "block");
  assert.match(
    texts(alone.reasons, "block")[0] ?? "",
    /published 4 days ago, under the minimum age of 7 days\. Pin an older release/,
  );
  const later = await check([vllm("0.32.1", published, { replaces: "0.31.0" })], { now });
  assert.equal(later.verdict, "block");
  assert.match(
    texts(later.reasons, "block")[0] ?? "",
    /not the earliest release that fixes a high or critical advisory of 0\.31\.0, which it replaces: GHSA-6757-hggm-hp2w is fixed first in 0\.32\.0; GHSA-h3rc-j82p-2c3h is fixed first in 0\.32\.0\.$/,
  );
  // Past 7 days, it passes on its own.
  assert.equal((await check([vllm("0.32.0", published)])).verdict, "pass");
});

test("a GO record takes its severity from an alias, and an exception by any alias accepts it", async () => {
  const osv = database();
  const blocked = await check([ollama], { osv });
  assert.equal(blocked.verdict, "block");
  assert.deepEqual(
    blocked.artifacts[0]?.advisories.map((a) => [a.id, a.severity, a.severityFrom, a.fixed]),
    [
      ["GO-2025-4251", "critical", "GHSA-f6mr-38g8-39rg database_specific, an alias", []],
      ["GO-2025-3557", "high", "GHSA-fccc-8m69-8r78 database_specific, an alias", []],
    ],
  );
  // The GHSA records were read only for their severity, GHSA before CVE.
  assert.deepEqual(osv.reads.slice(2), [
    "GHSA-fccc-8m69-8r78",
    "CVE-2025-0315",
    "GHSA-f6mr-38g8-39rg",
    "CVE-2025-63389",
  ]);
  assert.match(
    texts(blocked.reasons, "block")[0] ?? "",
    /GO-2025-4251 \(critical, .*No release fixes it; pin a release it does not affect, or add an exception for GO-2025-4251 with its reason\.$/,
  );

  const exceptions = [
    { id: "GHSA-fccc-8m69-8r78", reason: "The engine listens on the pod's loopback only." },
    { id: "cve-2025-63389", reason: "The gateway is the only client of the engine." },
    { id: "GHSA-0000-0000-0000", reason: "An old advisory." },
  ];
  const result = await check([ollama], { exceptions });
  assert.equal(result.verdict, "pass");
  const [artifact] = result.artifacts;
  assert.deepEqual(artifact?.exceptions, [exceptions[1], exceptions[0]]);
  assert.deepEqual(
    artifact?.advisories.map((a) => a.acceptedBecause),
    [exceptions[1]?.reason, exceptions[0]?.reason],
  );
  assert.deepEqual(texts(result.reasons, "note"), [
    "docker.io/ollama/ollama 0.35.1: GO-2025-4251 (critical, also CVE-2025-63389, GHSA-f6mr-38g8-39rg) is accepted by the exception for cve-2025-63389: The gateway is the only client of the engine.",
    "docker.io/ollama/ollama 0.35.1: GO-2025-3557 (high, also CVE-2025-0315, GHSA-fccc-8m69-8r78) is accepted by the exception for GHSA-fccc-8m69-8r78: The engine listens on the pod's loopback only.",
    "The exception for GHSA-0000-0000-0000 matches no advisory of these releases, so it can go.",
  ]);
});

test("a GO record with no severity, and none on its aliases, is a warning that says so", async () => {
  const result = await check([
    {
      name: "golang.org/x/sys",
      version: "v0.37.0",
      publishedAt: days(200),
      osv: { ecosystem: "Go", package: "golang.org/x/sys" },
    },
  ]);
  assert.equal(result.verdict, "warn");
  assert.deepEqual(result.artifacts[0]?.advisories[0]?.fixed, ["0.44.0"]);
  assert.deepEqual(texts(result.reasons, "warning"), [
    "golang.org/x/sys v0.37.0: it has GO-2026-5024 (no severity, also CVE-2026-39824): Invoking integer overflow in NewNTUnicodeString in golang.org/x/sys/windows. It carries no severity, and none of its aliases has one, so review it by hand; fixed in 0.44.0.",
  ]);
});

test("when OSV.dev does not answer, a passing result of the last 24 hours stands, with a warning", async () => {
  const cache = new MemoryReleaseCheckCache();
  const artifacts = [vllm("0.32.0", "2026-10-18T10:03:29Z"), node];
  const first = await check(artifacts, { cache });
  assert.equal(first.verdict, "pass");
  assert.equal(cache.entries.size, 1);

  const down = database(new OsvUnavailable("OSV.dev answered POST /v1/querybatch with 503.", 503));
  const later = new Date(NOW.getTime() + 23 * 3_600_000);
  const cached = await check(artifacts, { now: later, osv: down, cache });
  assert.equal(cached.verdict, "warn");
  assert.equal(cached.source, "cache");
  assert.equal(cached.cachedFrom, NOW.toISOString());
  assert.equal(cached.checkedAt, later.toISOString());
  assert.deepEqual(texts(cached.reasons, "warning"), [
    "OSV.dev answered POST /v1/querybatch with 503. The same releases passed at 2026-10-30T12:00:00.000Z, within the last 24 hours, so that result stands.",
  ]);
  assert.deepEqual(cached.artifacts, first.artifacts);

  // Older than 24 hours, for other exceptions, or with nothing cached: blocked.
  const tooOld = new Date(NOW.getTime() + 25 * 3_600_000);
  for (const [now, exceptions, store] of [
    [tooOld, [], cache],
    [later, [{ id: "GHSA-x", reason: "Accepted." }], cache],
    [later, [], new MemoryReleaseCheckCache()],
  ] as const) {
    const blocked = await check(artifacts, {
      now,
      exceptions: [...exceptions],
      osv: down,
      cache: store,
    });
    assert.equal(blocked.verdict, "block");
    assert.equal(blocked.source, "live");
    assert.deepEqual(texts(blocked.reasons, "block"), [
      "vllm 0.32.0: its advisories could not be read from OSV.dev.",
      "OSV.dev answered POST /v1/querybatch with 503. No passing check of the same releases and exceptions from the last 24 hours is cached, so they cannot be checked; try again later.",
    ]);
  }
  // A result from the cache is not cached again, so it cannot extend itself.
  assert.equal(cache.entries.size, 1);
});

test("a blocked result is not cached, and an unusable answer blocks even with a cache", async () => {
  const cache = new MemoryReleaseCheckCache();
  await check([vllm("0.31.0", "2026-10-03T08:06:44Z")], { cache });
  assert.equal(cache.entries.size, 0);

  const artifacts = [vllm("0.32.0", "2026-10-18T10:03:29Z")];
  await check(artifacts, { cache });
  const result = await check(artifacts, {
    osv: database(new OsvUnusable("OSV.dev answered POST /v1/querybatch with 400.", 400)),
    cache,
  });
  assert.equal(result.verdict, "block");
  assert.match(
    texts(result.reasons, "block")[1] ?? "",
    /^OSV.dev's advisories could not be read: OSV.dev answered POST \/v1\/querybatch with 400\.$/,
  );
});

test("an artifact without an advisory database is checked for its age only", async () => {
  const osv = database(new OsvUnavailable("down"));
  const old = await check([node], { osv });
  assert.equal(old.verdict, "pass");
  assert.deepEqual(texts(old.reasons, "note"), [
    "node 24.22.1: no advisory database is named for it, so OSV.dev was not asked; its advisories are checked by hand when it is pinned.",
  ]);
  const young = await check([{ ...node, publishedAt: days(0.5) }], { osv });
  assert.match(
    texts(young.reasons, "block")[0] ?? "",
    /^node 24\.22\.1: it was published 12 hours ago/,
  );
  const bypass = await check([{ ...node, publishedAt: days(2), replaces: "24.21.0" }], { osv });
  assert.match(
    texts(bypass.reasons, "block")[0] ?? "",
    /nothing shows that it fixes an advisory of 24\.21\.0/,
  );
  const unreadable = await check([{ ...node, publishedAt: "last week" }], { osv });
  assert.match(texts(unreadable.reasons, "block")[0] ?? "", /"last week", cannot be read/);
});

test("provenance is recorded, never required; an exception needs its reason", async () => {
  const provenance = { attested: false, immutable: false, revision: "4f2a9c1" };
  const result = await check([{ ...node, provenance }]);
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.artifacts[0]?.provenance, provenance);

  const noReason = await check([ollama], { exceptions: [{ id: "GO-2025-3557", reason: " " }] });
  assert.equal(noReason.verdict, "block");
  assert.ok(
    texts(noReason.reasons, "block").includes(
      "The exception for GO-2025-3557 gives no reason; each exception says why its advisory is accepted.",
    ),
  );
  assert.equal(noReason.artifacts[0]?.exceptions.length, 0);
});

test("the cache's key ignores the order of artifacts and exceptions, not their content", () => {
  const a = vllm("0.32.0", "2026-10-18T10:03:29Z");
  const e = [
    { id: "A", reason: "a" },
    { id: "B", reason: "b" },
  ];
  assert.equal(releaseCheckKey([a, node], e), releaseCheckKey([node, a], [...e].reverse()));
  assert.notEqual(releaseCheckKey([a], e), releaseCheckKey([{ ...a, replaces: "0.31.0" }], e));
  assert.notEqual(releaseCheckKey([a], e), releaseCheckKey([a], [{ id: "A", reason: "other" }]));
  assert.match(releaseCheckKey([], []), /^[0-9a-f]{64}$/);
});

test("CVSS 3 base scores", () => {
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H"), 8.1);
  assert.equal(cvss3("CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"), 7.5);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), 6.1);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H"), 9.9);
  assert.equal(cvss3("CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H"), null);
  assert.equal(cvss3("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N"), null);
});

test("versions in order, PEP 440's and semantic ones", () => {
  const sorted = ["0.9.2", "0.10.1", "0.10.1.1", "1.0.0rc1", "1.0.0", "v1.0.0.post1", "1.18.7"];
  assert.deepEqual([...sorted].reverse().sort(compareVersions), sorted);
  assert.equal(compareVersions("v0.32.0", "0.32.0"), 0);
  assert.equal(compareVersions("1.0.0+cpu", "1.0.0"), 0);
});

test("the fixes of a version: the first fixed event above it, in the ranges it falls in", () => {
  const query = { package: { ecosystem: "PyPI", name: "Foo_Bar" }, version: "1.5.0" };
  const record = (ranges: { events: Record<string, string>[] }[], versions?: string[]) => ({
    id: "X",
    affected: [
      {
        package: { ecosystem: "PyPI", name: "foo-bar" },
        ranges: ranges.map((r) => ({ type: "ECOSYSTEM", ...r })),
        ...(versions ? { versions } : {}),
      },
    ],
  });
  const two = record([
    {
      events: [
        { introduced: "0" },
        { fixed: "1.2.0" },
        { introduced: "1.4.0" },
        { fixed: "1.6.1" },
      ],
    },
    { events: [{ fixed: "1.7.0" }, { introduced: "1.5.0" }] },
  ]);
  assert.deepEqual(fixesFor(two, query), ["1.6.1", "1.7.0"]);
  assert.deepEqual(
    fixesFor(record([{ events: [{ introduced: "0" }, { last_affected: "1.5.0" }] }]), query),
    [],
  );
  assert.deepEqual(
    fixesFor(record([{ events: [{ introduced: "0" }, { fixed: "1.5.0" }] }]), query),
    [],
  );
  // Only the `versions` list says it is affected: any later fix.
  assert.deepEqual(
    fixesFor(record([{ events: [{ introduced: "2.0.0" }, { fixed: "2.1.0" }] }], ["1.5.0"]), query),
    ["2.1.0"],
  );
  assert.deepEqual(
    fixesFor(record([{ events: [{ introduced: "0" }, { fixed: "2.0.0" }] }]), {
      ...query,
      package: { ecosystem: "Go", name: "foo-bar" },
    }),
    [],
  );
});
