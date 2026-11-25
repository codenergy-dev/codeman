import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { ENGINE_RELEASES, NODE_RELEASE } from "../../../src/inference/images.ts";
import { Osv } from "../../../src/inference/osv.ts";
import { checkReleases, MemoryReleaseCheckCache } from "../../../src/inference/release-policy.ts";
import { affects, OsvFake } from "./osv.ts";

const fake = new OsvFake();
let osv: Osv;
let origin = "";
before(async () => {
  origin = await fake.server.listen();
  osv = new Osv(redirects({ CODEMAN_E2E_ENDPOINTS: JSON.stringify({ osv: origin }) }).fetch);
});
after(() => fake.server.close());
beforeEach(() => fake.server.reset());

/** The policy's check of an engine's catalog release and Node.js, as `open-key` runs it. */
function check(engine: string, now = new Date("2026-11-30T00:00:00Z")) {
  const pinned = ENGINE_RELEASES[engine];
  assert.ok(pinned);
  return checkReleases([pinned.release, NODE_RELEASE.release], {
    now,
    exceptions: pinned.exceptions,
    osv,
    cache: new MemoryReleaseCheckCache(),
  });
}

test("the catalog's releases pass: Ollama's 9 advisories by their exceptions, vLLM with none", async () => {
  const ollama = await check("ollama");
  assert.notEqual(ollama.verdict, "block", JSON.stringify(ollama.reasons));
  const found = ollama.artifacts.find((one) => one.name === "ollama");
  assert.equal(found?.exceptions.length, 9);
  const vllm = await check("vllm");
  assert.equal(vllm.verdict, "pass", JSON.stringify(vllm.reasons));
  const paths = fake.server.requests.map((request) => `${request.method} ${request.path}`);
  assert.ok(paths.includes("POST /v1/querybatch"));
  assert.ok(paths.includes("GET /v1/vulns/GO-2025-4251"));
});

test("a record added through the control API blocks the release it affects", async () => {
  const added = await fetch(`${origin}/_fake/osv/records`, {
    method: "PUT",
    body: JSON.stringify({
      records: [
        {
          id: "GHSA-e2e0-0000-0001",
          summary: "A critical advisory of the e2e suite",
          database_specific: { severity: "CRITICAL" },
          affected: [
            {
              package: { ecosystem: "PyPI", name: "vllm" },
              ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "0.32.1" }] }],
            },
          ],
        },
      ],
    }),
  });
  assert.equal(added.status, 204);
  const vllm = await check("vllm");
  assert.equal(vllm.verdict, "block");
  assert.match(JSON.stringify(vllm.reasons), /GHSA-e2e0-0000-0001 \(critical/);
  // A reset forgets it.
  fake.server.reset();
  assert.equal((await check("vllm")).verdict, "pass");
});

test("answers as OSV.dev does: no vulns field without any, 404 for an unknown record", async () => {
  const batch = await fetch(`${origin}/v1/querybatch`, {
    method: "POST",
    body: JSON.stringify({
      queries: [
        { package: { ecosystem: "PyPI", name: "vllm" }, version: "0.31.0" },
        { package: { ecosystem: "PyPI", name: "vllm" }, version: "0.32.0" },
      ],
    }),
  });
  const { results } = (await batch.json()) as { results: { vulns?: { id: string }[] }[] };
  assert.deepEqual(
    results.map((result) => result.vulns?.map((vuln) => vuln.id)),
    [
      [
        "GHSA-542m-9234-8gvf",
        "GHSA-6757-hggm-hp2w",
        "GHSA-h3rc-j82p-2c3h",
        "PYSEC-2026-4319",
        "PYSEC-2026-4345",
        "PYSEC-2026-4346",
      ],
      undefined,
    ],
  );
  assert.equal((await fetch(`${origin}/v1/vulns/GHSA-nope-nope-nope`)).status, 404);
  const bad = await fetch(`${origin}/v1/querybatch`, { method: "POST", body: "{}" });
  assert.equal(bad.status, 400);
});

test("a range holds the versions from introduced, up to fixed excluded or last_affected included", () => {
  const record = (events: Record<string, string>[], versions?: string[]) => ({
    id: "X",
    affected: [
      {
        package: { ecosystem: "Go", name: "m" },
        ranges: [{ type: "SEMVER", events }],
        ...(versions ? { versions } : {}),
      },
    ],
  });
  const at = (version: string) => ({ package: { ecosystem: "Go", name: "m" }, version });
  const fixed = record([{ introduced: "0.2.0" }, { fixed: "0.3.0" }]);
  assert.deepEqual(
    ["0.1.0", "0.2.0", "0.2.9", "0.3.0"].map((v) => affects(fixed, at(v))),
    [false, true, true, false],
  );
  const last = record([{ introduced: "0" }, { last_affected: "0.3.14" }]);
  assert.deepEqual(
    ["0.3.14", "0.3.15"].map((v) => affects(last, at(v))),
    [true, false],
  );
  assert.equal(affects(record([{ introduced: "0" }]), at("0.40.10")), true);
  assert.equal(affects(record([], ["1.0.0"]), at("1.0.0")), true);
  assert.equal(
    affects(fixed, { package: { ecosystem: "Go", name: "other" }, version: "0.2.0" }),
    false,
  );
});
