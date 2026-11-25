// biome-ignore-all lint/suspicious/noExplicitAny: third-party JSON, untrusted, read field by field in a prototype.
// Resolves an engine published as a GitHub release: Ollama's linux-amd64 assets, each with the
// `digest` GitHub records, checked against the release's checksums file; the tag's commit and its
// verification; the release's immutability; GitHub's artifact attestations per digest; and the
// advisories of the engine and of its Go modules (go.mod at the tag, dates from the Go proxy).
//
// Usage: node resolve-github.ts [owner/repo] [tag]   (default: ollama/ollama v0.35.1)
// Writes out/ollama.json and prints a summary. About 8 GitHub requests, cached.

import { createHash } from "node:crypto";
import {
  type Artifact,
  ageDays,
  cachedFetch,
  cooldownCounts,
  github,
  githubAdvisories,
  network,
  osvAdvisories,
  writeResolution,
} from "./lib.ts";

const [repo = "ollama/ollama", tag = "v0.35.1"] = process.argv.slice(2);
const minimumAgeDays = 14;

const release = await github(`/repos/${repo}/releases/tags/${tag}`);
if (!release) throw new Error(`${repo} has no release ${tag}.`);
const assets: any[] = release.assets.filter((a: any) => /linux-amd64/.test(a.name));

// The release's checksums file, if it ships one: a release asset, not an API call.
const sums: any = release.assets.find((a: any) => /sha256sum|checksums/i.test(a.name));
const listed: Record<string, string> = {};
if (sums) {
  const text = (await cachedFetch(sums.browser_download_url)).body;
  const sha = createHash("sha256").update(text).digest("hex");
  if (sums.digest && sums.digest !== `sha256:${sha}`)
    throw new Error("The checksums file does not match its digest.");
  for (const line of text.split("\n")) {
    const [hex, name] = line.trim().split(/\s+\*?\.?\/?/);
    if (hex && name) listed[name] = hex;
  }
}

// The tag's commit: a lightweight tag points at it, an annotated one through a tag object.
const ref = await github(`/repos/${repo}/git/ref/tags/${tag}`);
let tagObject: any = null;
let commitSha: string = ref?.object?.sha;
if (ref?.object?.type === "tag") {
  tagObject = await github(`/repos/${repo}/git/tags/${ref.object.sha}`);
  commitSha = tagObject?.object?.sha;
}
const commit = await github(`/repos/${repo}/commits/${commitSha}`);

const artifacts: Artifact[] = [];
const perAsset: Record<string, unknown> = {};
for (const asset of assets) {
  const sha256 = String(asset.digest ?? "").replace(/^sha256:/, "");
  const attestations = sha256 ? await github(`/repos/${repo}/attestations/sha256:${sha256}`) : null;
  perAsset[asset.name] = {
    digest: asset.digest ?? null,
    inChecksumsFile: listed[asset.name] ? listed[asset.name] === sha256 : null,
    attestations: attestations?.attestations?.length ?? 0,
    attestationPredicates: (attestations?.attestations ?? []).map(
      (a: any) => a.bundle?.dsseEnvelope?.payloadType,
    ),
    uploader: asset.uploader?.login ?? null,
  };
  artifacts.push({
    name: asset.name,
    version: tag,
    url: asset.browser_download_url,
    sha256,
    size: asset.size,
    publishedAt: asset.updated_at ?? asset.created_at,
  });
}

// The Go modules compiled into the binary, from go.mod at the tag's commit (raw, not the API).
const goMod = (await cachedFetch(`https://raw.githubusercontent.com/${repo}/${commitSha}/go.mod`))
  .body;
const modules = [
  ...goMod.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v\S+)(\s*\/\/ indirect)?\s*$/gm),
].map(([, path, version, indirect]) => ({ path, version, indirect: Boolean(indirect) }));
const escapePath = (path: string) => path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
const moduleDates: Record<string, string | null> = {};
for (const m of modules) {
  const info = await cachedFetch(
    `https://proxy.golang.org/${escapePath(m.path)}/@v/${m.version}.info`,
  );
  moduleDates[`${m.path}@${m.version}`] = info.status === 200 ? JSON.parse(info.body).Time : null;
}

// Advisories: OSV for the engine and its modules in one batch; GitHub's database and the
// repository's own advisories for the engine.
const version = tag.replace(/^v/, "");
const osv = await osvAdvisories([
  { name: `github.com/${repo}`, ecosystem: "Go", version },
  ...modules.map((m) => ({ name: m.path, ecosystem: "Go", version: m.version.replace(/^v/, "") })),
]);
const ghsa = await githubAdvisories("go", [`github.com/${repo}@${version}`]);
const repoAdvisories =
  (await github<any[]>(`/repos/${repo}/security-advisories?per_page=100`)) ?? [];
const osvIds = new Set(osv.flatMap((a) => [a.id, ...a.aliases]));
const githubOnly = ghsa.filter((a) => !osvIds.has(a.id) && !a.aliases.some((x) => osvIds.has(x)));

const resolution = {
  engine: "ollama",
  format: "github-release" as const,
  resolvedAt: new Date().toISOString(),
  artifacts,
  checks: {
    minimumAgeDays,
    age: {
      releasePublishedAt: release.published_at,
      releaseAgeDays: Number(ageDays(release.published_at)?.toFixed(1)),
      // A release's assets can be replaced after it is published unless it is immutable.
      assetUpdatedAt: Object.fromEntries(assets.map((a) => [a.name, a.updated_at])),
      goModules: modules.length,
      goModulesPublishedWithin: cooldownCounts(Object.values(moduleDates)),
      youngestGoModules: Object.entries(moduleDates)
        .sort(([, a], [, b]) => String(b).localeCompare(String(a)))
        .slice(0, 5),
      notCovered:
        "the C/C++ and CUDA libraries in lib/ollama (llama.cpp, ggml, CUDA runtime): no manifest gives their versions or dates",
    },
    advisories: [...osv, ...githubOnly],
    repositoryAdvisories: repoAdvisories.map((a) => ({
      id: a.ghsa_id,
      severity: a.severity,
      summary: a.summary,
    })),
    provenance: {
      immutable: release.immutable ?? "not reported",
      tag: {
        type: ref?.object?.type,
        verified: tagObject?.verification?.verified ?? null,
        reason: tagObject?.verification?.reason ?? null,
      },
      commit: {
        sha: commitSha,
        verified: commit?.commit?.verification?.verified ?? null,
        reason: commit?.commit?.verification?.reason ?? null,
        committer: commit?.commit?.committer?.name ?? null,
      },
      checksumsFile: sums
        ? { name: sums.name, digest: sums.digest ?? null, sameReleaseOnly: true }
        : null,
      perAsset,
    },
  },
};
const file = writeResolution(resolution as never);

const bySeverity: Record<string, number> = {};
for (const a of resolution.checks.advisories)
  bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
console.log(
  `# ollama ${tag}: ${artifacts.length} linux-amd64 assets, ${(artifacts.reduce((s, a) => s + (a.size ?? 0), 0) / 1e9).toFixed(2)} GB`,
);
console.log(`  written to ${file}`);
console.log(
  `  release published ${release.published_at}, immutable: ${resolution.checks.provenance.immutable}`,
);
console.log(
  `  tag ${ref?.object?.type}, commit ${commitSha} verified: ${commit?.commit?.verification?.verified} (${commit?.commit?.verification?.reason})`,
);
for (const [name, a] of Object.entries(perAsset)) console.log(`  ${name}: ${JSON.stringify(a)}`);
console.log(
  `  Go modules: ${modules.length}, published within 7/14/30 days: ${JSON.stringify(resolution.checks.age.goModulesPublishedWithin)}`,
);
console.log(
  `  advisories: ${resolution.checks.advisories.length} ${JSON.stringify(bySeverity)}, repository advisories: ${repoAdvisories.length}, GitHub only: ${githubOnly.length}`,
);
for (const a of resolution.checks.advisories)
  console.log(
    `    ${a.severity} ${a.id} ${a.package}@${a.version} fix=${a.fixed}: ${a.summary.slice(0, 80)}`,
  );
console.log(`  requests to the network: ${JSON.stringify(network)}`);
