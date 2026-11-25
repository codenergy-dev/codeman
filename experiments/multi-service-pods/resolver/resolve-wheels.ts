// biome-ignore-all lint/suspicious/noExplicitAny: third-party JSON, untrusted, read field by field in a prototype.
// Resolves an engine's wheel set from the locks lock.ts wrote: per wheel, its upload time and
// SHA-256 from PyPI's JSON API (or the PyTorch index's HTML page), its PEP 740 provenance from
// PyPI's Integrity API, and the set's advisories from OSV.dev (one batch) and GitHub.
//
// Usage: node resolve-wheels.ts <engine> [lock]
//   [lock]  14d (the default), 14d-fixed, 14d-fixed-strict, 7d or 30d: reads
//           out/pylock.<engine>-<lock>.toml, and out/pylock.<engine>-{latest,7d,30d}.toml when
//           present, for the cooldown counts.
// Writes out/<engine>.json for 14d, out/<engine>-<fixed|fixed-strict|7d|30d>.json otherwise, and
// prints a summary. From 14d, it also writes out/fixes.<engine>.json, the floors and exceptions
// of the bypass rule, which `node lock.ts <engine> "14 days+fixes-strict"` applies.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Advisory,
  type Artifact,
  ageDays,
  cachedFetch,
  compareVersions,
  cooldownCounts,
  getJson,
  githubAdvisories,
  NOW,
  network,
  OUT,
  osvAdvisories,
  PLATFORM,
  pypiName,
  UV_IMAGE,
  writeResolution,
} from "./lib.ts";

interface LockedWheel {
  name: string;
  version: string;
  url: string;
  sha256: string;
  size: number | null;
  uploadTime: string | null;
}

/** The packages of a pylock.toml as uv writes it: one `[[packages]]` table, wheels inline. */
export function readPylock(file: string): LockedWheel[] {
  const wheels: LockedWheel[] = [];
  for (const block of readFileSync(file, "utf8").split("[[packages]]").slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    if (!name || !version) continue;
    const files = [
      ...block.matchAll(/\{ url = "([^"]+)"([^}]*)hashes = \{ sha256 = "([0-9a-f]{64})" \} \}/g),
    ];
    if (!files.length) throw new Error(`${name} ${version} has no wheel in ${file}.`);
    for (const [, url, rest, sha256] of files) {
      wheels.push({
        name,
        version,
        url,
        sha256,
        size: Number(rest.match(/size = (\d+)/)?.[1] ?? Number.NaN) || null,
        uploadTime: rest.match(/upload-time = (\S+?),/)?.[1] ?? null,
      });
    }
  }
  return wheels;
}

const filename = (url: string) => decodeURIComponent(url.split("/").pop() ?? "");

/** How specific a wheel's tags are for CPython 3.12: the installer would prefer the highest. */
function specificity(url: string): number {
  const name = filename(url);
  return name.includes("-cp312-cp312-")
    ? 3
    : name.includes("-abi3-")
      ? 2
      : name.includes("-none-any")
        ? 0
        : 1;
}

/** One wheel per package, as the pod installs them with `--no-deps`: uv's lock may list several. */
export function onePerPackage(wheels: LockedWheel[]): { chosen: LockedWheel[]; dropped: string[] } {
  const best = new Map<string, LockedWheel>();
  const dropped: string[] = [];
  for (const w of wheels) {
    const current = best.get(w.name);
    if (current)
      dropped.push(filename(specificity(w.url) > specificity(current.url) ? current.url : w.url));
    if (!current || specificity(w.url) > specificity(current.url)) best.set(w.name, w);
  }
  return { chosen: [...best.values()], dropped };
}

interface FileFacts {
  uploadTime: string | null;
  sha256: string | null;
  size: number | null;
  firstUploadOfVersion: string | null;
  yanked: boolean | null;
  author: string | null;
  maintainer: string | null;
  source: string;
}

/** A wheel's facts from PyPI's JSON API, `GET /pypi/<name>/<version>/json`. */
async function pypiFacts(w: LockedWheel): Promise<FileFacts & { vulnerabilities: unknown[] }> {
  const release = await getJson(`https://pypi.org/pypi/${w.name}/${w.version}/json`);
  const file = release?.urls?.find((u: any) => u.filename === filename(w.url));
  const uploads = (release?.urls ?? []).map((u: any) => u.upload_time_iso_8601).sort();
  return {
    uploadTime: file?.upload_time_iso_8601 ?? null,
    sha256: file?.digests?.sha256 ?? null,
    size: file?.size ?? null,
    firstUploadOfVersion: uploads[0] ?? null,
    yanked: file?.yanked ?? null,
    author: release?.info?.author || release?.info?.author_email || null,
    maintainer: release?.info?.maintainer || release?.info?.maintainer_email || null,
    vulnerabilities: release?.vulnerabilities ?? [],
    source: "pypi-json",
  };
}

/**
 * A wheel's facts from the PyTorch index, which serves only HTML (PEP 503): the SHA-256 in the
 * link's fragment and `data-upload-time`. No size (a HEAD gives it), no yank, no provenance.
 */
async function pytorchFacts(w: LockedWheel, index: string): Promise<FileFacts> {
  const page = await cachedFetch(`${index}/${w.name}/`, { headers: { Accept: "text/html" } });
  const name = filename(w.url);
  const anchor = page.body
    .split("<a ")
    .find((a) => a.includes(`>${name}<`) || a.includes(`>${name}</a>`));
  const head = await cachedFetch(w.url, { method: "HEAD" });
  return {
    uploadTime: anchor?.match(/data-upload-time="([^"]+)"/)?.[1] ?? null,
    sha256: anchor?.match(/#sha256=([0-9a-f]{64})/)?.[1] ?? null,
    size: Number(head.headers["content-length"]) || null,
    firstUploadOfVersion: null,
    yanked: null,
    author: null,
    maintainer: null,
    source: "pytorch-index-html",
  };
}

interface Provenance {
  attested: boolean;
  publisher?: { kind: string; repository?: string; workflow?: string; environment?: string | null };
  subjectMatches?: boolean;
}

/** PEP 740 provenance from PyPI's Integrity API; the statement's subject must be this file. */
async function pypiProvenance(w: LockedWheel): Promise<Provenance> {
  const url = `https://pypi.org/integrity/${w.name}/${w.version}/${filename(w.url)}/provenance`;
  const body = await getJson(url, { Accept: "application/vnd.pypi.integrity.v1+json" });
  const bundle = body?.attestation_bundles?.[0];
  if (!bundle) return { attested: false };
  const statement = JSON.parse(
    Buffer.from(bundle.attestations[0].envelope.statement, "base64").toString("utf8"),
  );
  return {
    attested: true,
    publisher: {
      kind: bundle.publisher.kind,
      repository: bundle.publisher.repository ?? bundle.publisher.project,
      workflow: bundle.publisher.workflow,
      environment: bundle.publisher.environment ?? null,
    },
    // The signature itself is not verified here: that needs Sigstore's trust root.
    subjectMatches: statement.subject?.some(
      (s: any) => s.name === filename(w.url) && s.digest?.sha256 === w.sha256,
    ),
  };
}

const PYTORCH_INDEX = "https://download.pytorch.org/whl/cpu";

async function main() {
  const [engine, lock = "14d"] = process.argv.slice(2);
  if (!engine || !/^(7d|30d|14d(-fixed(-strict)?)?)$/.test(lock)) {
    console.error(
      "Usage: node resolve-wheels.ts <engine> [14d | 14d-fixed | 14d-fixed-strict | 7d | 30d]",
    );
    process.exit(2);
  }
  const minimumAgeDays = Number.parseInt(lock, 10);
  const lockFile = (label: string) => join(OUT, `pylock.${engine}-${label}.toml`);
  const { chosen: wheels, dropped } = onePerPackage(readPylock(lockFile(lock)));
  const resolvedAt = new Date().toISOString();

  // Per wheel: the index's facts, checked against the lock, and its provenance.
  const artifacts: Artifact[] = [];
  const mismatches: string[] = [];
  const lateUploads: string[] = [];
  const freeText: Record<string, { author: string | null; maintainer: string | null }> = {};
  const perArtifact: Record<string, Provenance & { index: string }> = {};
  const pypiVulns: Record<string, unknown[]> = {};
  for (const w of wheels) {
    const onPypi = new URL(w.url).host === "files.pythonhosted.org";
    const facts = onPypi ? await pypiFacts(w) : await pytorchFacts(w, PYTORCH_INDEX);
    if (facts.sha256 !== w.sha256)
      mismatches.push(`${w.name}: lock ${w.sha256}, index ${facts.sha256}`);
    if (facts.firstUploadOfVersion && facts.uploadTime) {
      const lag =
        (Date.parse(facts.uploadTime) - Date.parse(facts.firstUploadOfVersion)) / 86_400_000;
      if (lag > 1)
        lateUploads.push(
          `${w.name} ${w.version}: wheel uploaded ${lag.toFixed(1)} days after the release's first file`,
        );
    }
    if (onPypi) {
      freeText[w.name] = { author: facts.author, maintainer: facts.maintainer };
      const v = (facts as { vulnerabilities: unknown[] }).vulnerabilities;
      if (v.length) pypiVulns[w.name] = v;
    }
    perArtifact[w.name] = {
      index: facts.source,
      ...(onPypi ? await pypiProvenance(w) : { attested: false }),
    };
    artifacts.push({
      name: w.name,
      version: w.version,
      url: w.url,
      sha256: w.sha256,
      size: w.size ?? facts.size,
      publishedAt: facts.uploadTime ?? w.uploadTime,
    });
  }

  // How often each cooldown holds something back: the newest versions' ages, and what changed.
  const latest = existsSync(lockFile("latest"))
    ? onePerPackage(readPylock(lockFile("latest"))).chosen
    : [];
  const heldBack: Record<string, string[]> = {};
  for (const label of ["7d", "14d", "30d"]) {
    if (!existsSync(lockFile(label))) continue;
    const locked = new Map(readPylock(lockFile(label)).map((w) => [pypiName(w.name), w.version]));
    heldBack[label] = latest
      .filter((w) => locked.get(pypiName(w.name)) !== w.version)
      .map(
        (w) => `${w.name} ${locked.get(pypiName(w.name)) ?? "(absent)"} instead of ${w.version}`,
      );
    for (const [name] of locked) {
      if (!latest.some((w) => pypiName(w.name) === name))
        heldBack[label].push(`${name} (only with the cooldown)`);
    }
  }

  // Advisories: OSV for the locked set and the newest set in one batch, GitHub for the locked set.
  const query = (w: LockedWheel) => ({
    name: w.name,
    ecosystem: "PyPI",
    version: w.version.split("+")[0],
  });
  const queries = new Map(
    [...wheels, ...latest].map((w) => [`${pypiName(w.name)}@${query(w).version}`, query(w)]),
  );
  const all = await osvAdvisories([...queries.values()]);
  const lockedKey = new Set(wheels.map((w) => `${pypiName(w.name)}@${w.version.split("+")[0]}`));
  const osvLocked = all.filter((a) => lockedKey.has(`${pypiName(a.package)}@${a.version}`));
  const osvLatest = all.filter((a) => !lockedKey.has(`${pypiName(a.package)}@${a.version}`));
  let ghsa: Advisory[] = [];
  let ghsaError: string | null = null;
  try {
    ghsa = await githubAdvisories(
      "pip",
      wheels.map((w) => `${w.name}@${w.version.split("+")[0]}`),
    );
  } catch (error) {
    ghsaError = String(error);
  }
  const osvIds = new Set(osvLocked.flatMap((a) => [a.id, ...a.aliases]));
  const githubOnly = ghsa.filter((a) => !osvIds.has(a.id) && !a.aliases.some((x) => osvIds.has(x)));

  // The bypass rule: a fix younger than the cooldown passes only if it is the earliest release
  // that fixes an advisory affecting the version the cooldown allows.
  const bypass = [];
  const floors: Record<string, string> = {};
  const severities: Record<string, string[]> = {};
  const allowNewer: Record<string, string> = {};
  for (const a of [...osvLocked, ...githubOnly]) {
    if (!a.fixed) {
      bypass.push({
        advisory: a.id,
        package: a.package,
        allowed: a.version,
        fix: null,
        verdict: "no fix: block or accept",
      });
      continue;
    }
    const release = await getJson(`https://pypi.org/pypi/${a.package}/${a.fixed}/json`);
    const uploads = (release?.urls ?? []).map((u: any) => u.upload_time_iso_8601).sort();
    const published = uploads[0] ?? null;
    const age = ageDays(published);
    const name = pypiName(a.package);
    severities[name] = [...new Set([...(severities[name] ?? []), a.severity])];
    if (published && (!floors[name] || compareVersions(a.fixed, floors[name]) > 0)) {
      floors[name] = a.fixed;
      // Only the fixing release's files: one second after its last upload.
      if ((age ?? 0) < minimumAgeDays) {
        allowNewer[name] = new Date(Date.parse(uploads[uploads.length - 1]) + 1000).toISOString();
      } else delete allowNewer[name];
    }
    bypass.push({
      advisory: a.id,
      package: a.package,
      allowed: a.version,
      fix: a.fixed,
      fixPublishedAt: published,
      fixAgeDays: age === null ? null : Number(age.toFixed(1)),
      verdict:
        published === null
          ? "fix not found on PyPI"
          : (age ?? 0) >= minimumAgeDays
            ? "fix older than the cooldown: resolve again with a floor"
            : "bypass: the fix is younger than the cooldown",
    });
  }

  // No downgrade: every locked version is a floor too, or the resolver backtracks instead.
  const noDowngrade = Object.fromEntries(
    wheels.map((w) => [pypiName(w.name), w.version.split("+")[0]]),
  );
  if (lock === "14d") {
    const fixes = { floors, allowNewer, severities, noDowngrade };
    writeFileSync(join(OUT, `fixes.${engine}.json`), `${JSON.stringify(fixes, null, 2)}\n`);
  }

  const attested = Object.values(perArtifact).filter((p) => p.attested).length;
  const publishers: Record<string, number> = {};
  for (const p of Object.values(perArtifact)) {
    if (p.publisher) {
      const key = `${p.publisher.kind}:${p.publisher.repository}`;
      publishers[key] = (publishers[key] ?? 0) + 1;
    }
  }
  const known = artifacts.filter((a) => a.size !== null);
  const lockLog = readFileSync(lockFile(lock).replace(/\.toml$/, ".log"), "utf8");
  const resolution = {
    engine,
    format: "python-wheels" as const,
    resolvedAt,
    target: {
      python: "3.12",
      platform: PLATFORM,
      lockedBy: UV_IMAGE,
      excludeNewer: lockLog.match(/^exclude-newer: (\S+)/m)?.[1] ?? null,
      // The bypass rule's exceptions that this lock applied: package=date.
      exceptions:
        lockLog
          .match(/^exclude-newer-package: (.*)$/m)?.[1]
          .split(" ")
          .filter(Boolean) ?? [],
      install: "pip install --no-deps --only-binary :all: --require-hashes",
    },
    artifacts,
    checks: {
      minimumAgeDays,
      age: {
        youngestDays: Number(
          Math.min(...artifacts.map((a) => ageDays(a.publishedAt) ?? Infinity)).toFixed(1),
        ),
        newestSetPublishedWithin: cooldownCounts(latest.map((w) => w.uploadTime)),
        newestSetSize: latest.length,
        heldBack: Object.fromEntries(
          Object.entries(heldBack).map(([k, v]) => [k, { count: v.length, packages: v }]),
        ),
        lateUploads,
        indexMismatches: mismatches,
        alternativeWheelsDropped: dropped,
      },
      advisories: [...osvLocked, ...githubOnly],
      advisoriesOfNewestSet: osvLatest,
      pypiJsonVulnerabilities: pypiVulns,
      githubAdvisoryError: ghsaError,
      bypass,
      provenance: {
        attested,
        of: artifacts.length,
        publishers,
        perArtifact,
        freeTextAuthors: freeText,
      },
    },
  };
  const file = writeResolution(
    resolution as never,
    lock === "14d" ? engine : `${engine}-${lock.replace("14d-", "")}`,
  );

  // The summary.
  const bySeverity: Record<string, number> = {};
  for (const a of resolution.checks.advisories)
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
  console.log(
    `# ${engine}: ${artifacts.length} wheels, ${(known.reduce((s, a) => s + (a.size ?? 0), 0) / 1e9).toFixed(2)} GB (${artifacts.length - known.length} sizes unknown)`,
  );
  console.log(`  written to ${file}`);
  console.log(
    `  PEP 740 attestations: ${attested} of ${artifacts.length}; publishers ${JSON.stringify(publishers)}`,
  );
  console.log(
    `  newest set (${latest.length} packages) published within 7/14/30 days of ${NOW.toISOString().slice(0, 10)}: ${JSON.stringify(resolution.checks.age.newestSetPublishedWithin)}`,
  );
  for (const [k, v] of Object.entries(heldBack))
    console.log(`  a ${k} cooldown holds back ${v.length}: ${v.join("; ")}`);
  console.log(`  wheels the lock lists beside the chosen one: ${dropped.join(", ") || "none"}`);
  console.log(`  late uploads: ${lateUploads.length ? lateUploads.join("; ") : "none"}`);
  console.log(`  index mismatches: ${mismatches.length ? mismatches.join("; ") : "none"}`);
  console.log(
    `  advisories of the locked set: ${resolution.checks.advisories.length} ${JSON.stringify(bySeverity)} (GitHub only: ${githubOnly.length}${ghsaError ? `, GitHub failed: ${ghsaError}` : ""})`,
  );
  for (const b of bypass)
    console.log(`    ${b.advisory} ${b.package} ${b.allowed} -> ${b.fix ?? "-"}: ${b.verdict}`);
  console.log(`  advisories of the newest set not in the locked one: ${osvLatest.length}`);
  console.log(`  requests to the network: ${JSON.stringify(network)}`);
}

await main();
