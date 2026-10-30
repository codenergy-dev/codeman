// biome-ignore-all lint/suspicious/noExplicitAny: third-party JSON, untrusted, read field by field in a prototype.
// Resolves an engine published as an OCI image on Docker Hub, without pulling its layers: the
// index and linux/amd64 manifest digests, the config's `created` and labels, cosign signatures
// (the `sha256-<hex>.sig` tag), OCI referrers and BuildKit attestations; then the source commit
// the labels name, against the project's GitHub tag, and the engine's advisories on OSV.dev.
//
// Usage: node resolve-oci.ts [repository] [tag] [pypi-package]
//   (default: vllm/vllm-openai v0.31.0 vllm)
// Writes out/<package>-image.json and prints a summary. Two manifest GETs count as Docker Hub
// pulls; the signature checks are HEADs. Three GitHub requests, cached.

import {
  type Artifact,
  ageDays,
  cachedFetch,
  getJson,
  github,
  network,
  osvAdvisories,
  writeResolution,
} from "./lib.ts";

const [repository = "vllm/vllm-openai", tag = "v0.31.0", pkg = "vllm"] = process.argv.slice(2);
const REGISTRY = "https://registry-1.docker.io/v2";
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

// An anonymous pull token; never cached, it expires.
const auth = await fetch(
  `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
);
const { token } = (await auth.json()) as { token: string };
const headers = { Authorization: `Bearer ${token}`, Accept: ACCEPT };
const registry = (path: string, method = "GET") =>
  cachedFetch(`${REGISTRY}/${repository}${path}`, { method, headers });

const index = await registry(`/manifests/${tag}`);
if (index.status !== 200) throw new Error(`${repository}:${tag}: ${index.status}`);
const indexDigest = index.headers["docker-content-digest"];
const indexBody = JSON.parse(index.body);
const amd64 = indexBody.manifests?.find(
  (m: any) => m.platform?.os === "linux" && m.platform?.architecture === "amd64",
);
const manifest = JSON.parse((await registry(`/manifests/${amd64.digest}`)).body);
const config = JSON.parse((await registry(`/blobs/${manifest.config.digest}`)).body);
const labels: Record<string, string> = config.config?.Labels ?? {};
const size = manifest.layers.reduce((s: number, l: any) => s + l.size, 0) + manifest.config.size;

// Signatures and attestations the registry can hold.
const signatures: Record<string, unknown> = {};
for (const digest of [indexDigest, amd64.digest]) {
  const sig = await registry(`/manifests/sha256-${digest.slice(7)}.sig`, "HEAD");
  const att = await registry(`/manifests/sha256-${digest.slice(7)}.att`, "HEAD");
  const referrers = await registry(`/referrers/${digest}`);
  signatures[digest] = {
    cosignSignatureTag: sig.status,
    cosignAttestationTag: att.status,
    referrersApi: referrers.status,
    referrers:
      referrers.status === 200
        ? (JSON.parse(referrers.body).manifests ?? []).map((m: any) => m.artifactType)
        : null,
  };
}
const buildkitAttestations = (indexBody.manifests ?? []).filter(
  (m: any) => m.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
).length;

// The tag's page on Docker Hub: when it was last pushed (a tag can move).
const hub = await getJson(`https://hub.docker.com/v2/repositories/${repository}/tags/${tag}`);

// The source commit the labels claim, against the project's tag on GitHub.
const revision = labels["org.opencontainers.image.revision"] ?? null;
const source =
  labels["org.opencontainers.image.source"] ?? labels["org.opencontainers.image.url"] ?? null;
const sourceRepo = source?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1] ?? "vllm-project/vllm";
const ref = await github(`/repos/${sourceRepo}/git/ref/tags/${tag}`);
const tagCommit = ref?.object?.type === "commit" ? ref.object.sha : null;
const commit = tagCommit ? await github(`/repos/${sourceRepo}/commits/${tagCommit}`) : null;
const release = await github(`/repos/${sourceRepo}/releases/tags/${tag}`);

const version = tag.replace(/^v/, "");
const advisories = await osvAdvisories([{ name: pkg, ecosystem: "PyPI", version }]);

// The bypass rule for an image: the earliest fixing release, by its PyPI date and its image tag.
const fixes = [...new Set(advisories.map((a) => a.fixed).filter((f): f is string => Boolean(f)))];
const bypass = [];
for (const fix of fixes) {
  const pypi = await getJson(`https://pypi.org/pypi/${pkg}/${fix}/json`);
  const published = (pypi?.urls ?? []).map((u: any) => u.upload_time_iso_8601).sort()[0] ?? null;
  const image = await getJson(`https://hub.docker.com/v2/repositories/${repository}/tags/v${fix}`);
  const age = ageDays(published);
  bypass.push({
    fix,
    advisories: advisories.filter((a) => a.fixed === fix).map((a) => `${a.id} ${a.severity}`),
    publishedAt: published,
    ageDays: age === null ? null : Number(age.toFixed(1)),
    image: image
      ? { tag: `v${fix}`, digest: image.digest, lastPushed: image.tag_last_pushed }
      : null,
    verdict:
      age === null
        ? "fix not published"
        : age < 14
          ? "bypass: the fix is younger than the cooldown"
          : "upgrade",
  });
}

const artifacts: Artifact[] = [
  {
    name: `${repository}@${indexDigest}`,
    version: tag,
    url: `docker.io/${repository}@${amd64.digest}`,
    sha256: amd64.digest.slice(7),
    size,
    publishedAt: config.created ?? null,
  },
];
const resolution = {
  engine: `${pkg}-image`,
  format: "oci-image" as const,
  resolvedAt: new Date().toISOString(),
  artifacts,
  checks: {
    minimumAgeDays: 14,
    age: {
      configCreated: config.created ?? null,
      configAgeDays: Number(ageDays(config.created)?.toFixed(1)),
      tagLastPushed: hub?.tag_last_pushed ?? null,
      notCovered:
        "the image's Python and OS packages: no SBOM attestation, so only pulling the layers (E5) lists them",
    },
    advisories,
    bypass,
    provenance: {
      indexDigest,
      indexMediaType: indexBody.mediaType,
      platformDigest: amd64.digest,
      labels,
      revisionLabel: revision,
      tagCommit,
      revisionMatchesTag: revision && tagCommit ? revision === tagCommit : null,
      tagCommitVerified: commit?.commit?.verification?.verified ?? null,
      tagCommitReason: commit?.commit?.verification?.reason ?? null,
      githubReleaseImmutable: release?.immutable ?? null,
      buildkitAttestations,
      signatures,
    },
  },
};
const file = writeResolution(resolution as never);

const bySeverity: Record<string, number> = {};
for (const a of advisories) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
console.log(
  `# ${repository}:${tag}: index ${indexDigest}, linux/amd64 ${amd64.digest}, ${(size / 1e9).toFixed(2)} GB compressed`,
);
console.log(`  written to ${file}`);
console.log(`  config created ${config.created}, tag last pushed ${hub?.tag_last_pushed}`);
console.log(`  labels: ${JSON.stringify(labels)}`);
console.log(
  `  revision label ${revision}; ${sourceRepo} tag ${tag} -> ${tagCommit} (verified: ${resolution.checks.provenance.tagCommitVerified}); release immutable: ${release?.immutable}`,
);
console.log(
  `  signatures: ${JSON.stringify(signatures)}; BuildKit attestations in the index: ${buildkitAttestations}`,
);
console.log(
  `  advisories of ${pkg} ${version}: ${advisories.length} ${JSON.stringify(bySeverity)}`,
);
for (const b of bypass)
  console.log(
    `  fix ${b.fix} (${b.advisories.length} advisories), published ${b.publishedAt}, image ${b.image?.digest}: ${b.verdict}`,
  );
console.log(`  requests to the network: ${JSON.stringify(network)}`);
