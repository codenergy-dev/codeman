/**
 * Interim resolutions for E2 and E4, in the shape E3's resolver writes
 * (experiments/multi-service-pods/resolver/out/), made outside the pod. Not E3: no policy checks
 * beyond what each source offers. Runs on the host, with network.
 *
 * Usage:
 *   node resolve.ts python <tag> <asset name> <out.json>
 *     A python-build-standalone release asset: its GitHub digest, checked against SHA256SUMS.
 *   node resolve.ts model <Hugging Face id> <commit> <out.json>
 *     A model's files at a commit: LFS files by their SHA-256, small files hashed here.
 *   node resolve.ts wheels <pip installation report.json> <out.json>
 *     The wheels of `pip install --dry-run --report`, with their sizes and upload dates.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

interface Artifact {
  name: string;
  version: string;
  url: string;
  sha256: string;
  size: number;
  publishedAt: string | undefined;
  path?: string;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.json();
}

async function python(tag: string, asset: string): Promise<Record<string, unknown>> {
  const repo = "astral-sh/python-build-standalone";
  const release = (await getJson(`https://api.github.com/repos/${repo}/releases/tags/${tag}`)) as {
    published_at: string;
    immutable?: boolean;
    target_commitish: string;
    assets: { name: string; size: number; digest: string; browser_download_url: string }[];
  };
  const found = release.assets.find((one) => one.name === asset);
  const sums = release.assets.find((one) => one.name === "SHA256SUMS");
  if (!found || !sums) throw new Error(`${tag} has no ${asset} or SHA256SUMS.`);
  const text = await (await fetch(sums.browser_download_url)).text();
  const listed = text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];
  const digest = found.digest.replace(/^sha256:/, "");
  if (listed !== digest) throw new Error(`SHA256SUMS says ${listed}, GitHub says ${digest}.`);
  const attestations = (await getJson(
    `https://api.github.com/repos/${repo}/attestations/sha256:${digest}`,
  ).catch(() => ({ attestations: [] }))) as { attestations: unknown[] };
  return {
    engine: "python-3.12",
    format: "archive",
    resolvedAt: new Date().toISOString(),
    artifacts: [
      {
        name: "cpython",
        version: asset.split("-")[1],
        url: found.browser_download_url,
        sha256: digest,
        size: found.size,
        publishedAt: release.published_at,
      },
    ],
    checks: {
      sha256sums: "matches the asset's GitHub digest",
      releaseImmutable: release.immutable ?? false,
      releaseCommit: release.target_commitish,
      githubAttestations: attestations.attestations.length,
    },
  };
}

async function model(id: string, commit: string): Promise<Record<string, unknown>> {
  const info = (await getJson(
    `https://huggingface.co/api/models/${id}/revision/${commit}?blobs=true`,
  )) as {
    sha: string;
    lastModified: string;
    cardData?: { license?: string };
    siblings: { rfilename: string; size: number; lfs?: { sha256: string } }[];
  };
  if (info.sha !== commit) throw new Error(`${id} is at ${info.sha}, not ${commit}.`);
  const artifacts: Artifact[] = [];
  for (const file of info.siblings) {
    if (file.rfilename === ".gitattributes" || file.rfilename === "README.md") continue;
    // Pickled weights run code when loaded: only safetensors and plain files are resolved.
    if (/\.(bin|pt|pth|ckpt|pkl)$/.test(file.rfilename)) continue;
    const url = `https://huggingface.co/${id}/resolve/${commit}/${file.rfilename}`;
    let sha256 = file.lfs?.sha256;
    if (!sha256) {
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    artifacts.push({
      name: file.rfilename,
      version: commit,
      url,
      sha256,
      size: file.size,
      publishedAt: info.lastModified,
      path: file.rfilename,
    });
  }
  return {
    engine: id,
    format: "model-files",
    resolvedAt: new Date().toISOString(),
    artifacts,
    checks: { commit: info.sha, license: info.cardData?.license, pickleFilesSkipped: true },
  };
}

interface ReportItem {
  metadata: { name: string; version: string };
  download_info: { url: string; archive_info?: { hashes?: { sha256?: string } } };
}

async function wheels(reportFile: string): Promise<Record<string, unknown>> {
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as {
    pip_version: string;
    install: ReportItem[];
  };
  const artifacts: Artifact[] = [];
  for (const item of report.install) {
    const { name, version } = item.metadata;
    const url = item.download_info.url;
    const sha256 = item.download_info.archive_info?.hashes?.sha256;
    if (!sha256 || !url.endsWith(".whl")) throw new Error(`${name} has no wheel with a hash.`);
    const head = await fetch(url, { method: "HEAD" });
    let publishedAt: string | undefined;
    if (new URL(url).hostname === "files.pythonhosted.org") {
      // PyPI's JSON API gives each file's upload time.
      const release = (await getJson(`https://pypi.org/pypi/${name}/${version}/json`)) as {
        urls: { url: string; upload_time_iso_8601: string }[];
      };
      publishedAt = release.urls.find((file) => file.url === url)?.upload_time_iso_8601;
    } else {
      publishedAt = head.headers.get("last-modified") ?? undefined;
    }
    artifacts.push({
      name,
      version,
      url,
      sha256,
      size: Number(head.headers.get("content-length") ?? 0),
      publishedAt,
    });
  }
  return {
    engine: "diffusers-cpu",
    format: "python-wheels",
    resolvedAt: new Date().toISOString(),
    artifacts,
    checks: { interim: "pip install --dry-run --report, no policy", pip: report.pip_version },
  };
}

const [kind, a, b, c] = process.argv.slice(2);
let result: Record<string, unknown>;
let out: string | undefined;
if (kind === "python" && a && b && c) [result, out] = [await python(a, b), c];
else if (kind === "model" && a && b && c) [result, out] = [await model(a, b), c];
else if (kind === "wheels" && a && b) [result, out] = [await wheels(a), b];
else {
  console.error("Usage: node resolve.ts python|model|wheels ... (see the header)");
  process.exit(2);
}
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${out}.`);
