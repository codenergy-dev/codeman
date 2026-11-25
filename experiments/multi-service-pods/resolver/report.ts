// biome-ignore-all lint/suspicious/noExplicitAny: third-party JSON, untrusted, read field by field in a prototype.
// Prints E3's report from the resolutions in out/: the checks possible per format, the wheel
// sets' sizes, cooldown counts, attestations and advisories, and the bypass rule's outcome.
//
// Usage: node report.ts
//
// The whole experiment, from this directory (Docker for uv; responses cached in RESOLVER_CACHE):
//   export LOCK_AT=2026-10-30T14:21:00Z
//   for e in diffusers-cpu sglang vllm-omni; do node lock.ts $e; done
//   for e in diffusers-cpu sglang; do
//     node resolve-wheels.ts $e
//     node lock.ts $e "14 days+fixes" && node resolve-wheels.ts $e 14d-fixed
//     FIX_SEVERITIES=HIGH,CRITICAL node lock.ts $e "14 days+fixes-strict"
//     node resolve-wheels.ts $e 14d-fixed-strict
//     node resolve-wheels.ts $e 7d && node resolve-wheels.ts $e 30d
//   done
//   node resolve-github.ts && node resolve-oci.ts && node report.ts
//   npx biome format --write out   # JSON.stringify's layout is not Biome's

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NOW, OUT } from "./lib.ts";

const read = (name: string) => {
  const file = join(OUT, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};

console.log(
  `# E3: resolve outside, with the policy (measured against ${NOW.toISOString().slice(0, 10)})\n`,
);

console.log("## Checks possible per format\n");
console.log("| Check | GitHub release (Ollama) | Python wheels (PyPI) | OCI image (Docker Hub) |");
console.log("| --- | --- | --- | --- |");
const rows = [
  [
    "Exact digest",
    "Yes: each asset's `digest`, and `sha256sum.txt`",
    "Yes: SHA-256 per file in the lock, JSON and simple APIs",
    "Yes: index and platform manifest digests",
  ],
  [
    "Publish date of the artifact",
    "Yes: `published_at`, asset `updated_at`",
    "Yes: `upload_time` per file (PyTorch index: `data-upload-time` only, copy date)",
    "Partly: config `created` is set by the builder; Hub's `tag_last_pushed`",
  ],
  [
    "Dates of the whole tree",
    "Go modules only (go.mod + Go proxy); not the bundled C/C++/CUDA libraries",
    "Yes: every wheel of the lock",
    "No: needs the layers or an SBOM, which vLLM does not attach",
  ],
  [
    "Cooldown applied by the tool",
    "No: the resolver compares dates",
    'Yes: uv `--exclude-newer "14 days"`, per package `--exclude-newer-package`',
    "No: the resolver compares dates",
  ],
  [
    "Advisories of the engine",
    "OSV (Go, GO-* without severity) and GitHub; no repository advisories",
    "OSV in one batch; GitHub's `affects` is case-sensitive and misses some",
    "OSV for the engine's PyPI package only",
  ],
  [
    "Advisories of the tree",
    "Go modules: module level, not symbol level",
    "Yes",
    "No (E5: Trivy, Grype)",
  ],
  [
    "Commit behind the release",
    "Yes: the tag's commit",
    "Only through PEP 740 attestations",
    "Label `org.opencontainers.image.revision`, compared with the GitHub tag",
  ],
  [
    "Signed commit or tag",
    "Commit verified, by GitHub's web-flow key",
    "No",
    "Tag commit unsigned (vLLM)",
  ],
  [
    "Release immutability",
    "Reported: `immutable: false`",
    "Not applicable: PyPI files cannot be replaced, but new files can be added to a release",
    "No: a tag can move; only the digest is fixed",
  ],
  [
    "Artifact attestations",
    "API answers; none for Ollama's assets",
    "PEP 740 via the Integrity API, for part of the set",
    "No cosign `.sig`/`.att` tag, referrers API empty, no BuildKit attestations",
  ],
  [
    "Publisher identity",
    "Uploader `github-actions[bot]`",
    "Attested publisher (repository, workflow); `author`/`maintainer` are free text",
    "Labels, free text",
  ],
];
for (const r of rows) console.log(`| ${r.join(" | ")} |`);

console.log("\n## Wheel sets\n");
console.log(
  "| Engine | Packages | Size | PEP 740 | Newest set within 7 / 14 / 30 days | Held back by 7 / 14 / 30 days | Advisories at 14 days | With a fix | Fix younger than 14 days | After the bypass (high and critical, no downgrade) |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const engine of ["diffusers-cpu", "sglang", "vllm-omni"]) {
  const r = read(engine);
  if (!r) continue;
  const after = read(`${engine}-fixed-strict`) ?? read(`${engine}-fixed`);
  const size = r.artifacts.reduce((s: number, a: any) => s + (a.size ?? 0), 0) / 1e9;
  const within = r.checks.age.newestSetPublishedWithin;
  const held = r.checks.age.heldBack;
  const sev: Record<string, number> = {};
  for (const a of r.checks.advisories) sev[a.severity] = (sev[a.severity] ?? 0) + 1;
  const sevText = Object.entries(sev)
    .map(([k, v]) => `${v} ${k.toLowerCase()}`)
    .join(", ");
  const withFix = r.checks.advisories.filter((a: any) => a.fixed).length;
  const young = r.checks.bypass.filter((b: any) => b.verdict.startsWith("bypass")).length;
  const afterSev: Record<string, number> = {};
  for (const a of after?.checks.advisories ?? [])
    afterSev[a.severity] = (afterSev[a.severity] ?? 0) + 1;
  console.log(
    `| ${engine} | ${r.artifacts.length} | ${size.toFixed(2)} GB | ${r.checks.provenance.attested} | ${within["7d"]} / ${within["14d"]} / ${within["30d"]} of ${r.checks.age.newestSetSize} | ${held["7d"]?.count} / ${held["14d"]?.count} / ${held["30d"]?.count} | ${r.checks.advisories.length}: ${sevText} | ${withFix} | ${young} | ${after ? `${after.checks.advisories.length} ${JSON.stringify(afterSev)}` : "not run"} |`,
  );
}

console.log("\n## Advisories by cooldown (high and critical in brackets)\n");
console.log("| Engine | 7 days | 14 days | 30 days |");
console.log("| --- | --- | --- | --- |");
for (const engine of ["diffusers-cpu", "sglang"]) {
  const cell = (name: string) => {
    const r = read(name);
    if (!r) return "not run";
    const severe = r.checks.advisories.filter((a: any) =>
      ["HIGH", "CRITICAL"].includes(a.severity),
    ).length;
    return `${r.checks.advisories.length} (${severe})`;
  };
  console.log(
    `| ${engine} | ${cell(`${engine}-7d`)} | ${cell(engine)} | ${cell(`${engine}-30d`)} |`,
  );
}

const ollama = read("ollama");
if (ollama) {
  const sev: Record<string, number> = {};
  for (const a of ollama.checks.advisories) sev[a.severity] = (sev[a.severity] ?? 0) + 1;
  const own = ollama.checks.advisories.filter((a: any) => a.package === "github.com/ollama/ollama");
  console.log(`\n## Ollama ${ollama.artifacts[0]?.version}\n`);
  console.log(
    `- ${ollama.artifacts.length} linux-amd64 assets, ${(ollama.artifacts.reduce((s: number, a: any) => s + a.size, 0) / 1e9).toFixed(2)} GB; release ${ollama.checks.age.releaseAgeDays} days old; immutable: ${ollama.checks.provenance.immutable}.`,
  );
  console.log(
    `- Go modules: ${ollama.checks.age.goModules}; within 7/14/30 days: ${JSON.stringify(ollama.checks.age.goModulesPublishedWithin)}.`,
  );
  console.log(
    `- Advisories: ${ollama.checks.advisories.length} ${JSON.stringify(sev)}; Ollama's own: ${own.length}, ${own.filter((a: any) => !a.fixed).length} without a fix.`,
  );
}
const vllm = read("vllm-image");
if (vllm) {
  const sev: Record<string, number> = {};
  for (const a of vllm.checks.advisories) sev[a.severity] = (sev[a.severity] ?? 0) + 1;
  console.log(`\n## ${vllm.artifacts[0].name}\n`);
  console.log(
    `- Advisories of vLLM ${vllm.artifacts[0].version}: ${vllm.checks.advisories.length} ${JSON.stringify(sev)}.`,
  );
  for (const b of vllm.checks.bypass)
    console.log(`- Fix ${b.fix}: ${b.ageDays} days old, image ${b.image?.digest}: ${b.verdict}.`);
}

console.log("\n## The bypass rule\n");
console.log(
  [
    "1. Resolve with the cooldown (uv `--exclude-newer`, absolute date recorded in the resolution).",
    "2. Query OSV for every locked version. For each advisory at or above the blocking severity, take the earliest `fixed` event above the locked version.",
    "3. If that fix is older than the cooldown, add the floor `name>=fix`. If it is younger, also allow only that release: `--exclude-newer-package name=<its last upload + 1 s>`.",
    "4. Resolve again with every version of step 1 as a floor too (no downgrade). If it fails, the fix needs a newer parent: block, or accept in the settings.",
    "5. Query OSV again; the resolution records each exception with its advisory.",
  ].join("\n"),
);
