// biome-ignore-all lint/suspicious/noExplicitAny: third-party JSON, untrusted, read field by field in a prototype.
// Shared helpers of the resolver prototype: a fetch cached on disk, the resolution's shape,
// PEP 440 version order, OSV.dev and GitHub's advisory database.
// Not run directly: `resolve-*.ts` and `report.ts` import it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Responses are cached here, outside the repository, so a rerun makes no request. */
export const CACHE =
  process.env.RESOLVER_CACHE ??
  "/private/tmp/claude-503/-Users-lucaslannes-Developer-codenergy-codeman/12cd5436-7709-4be1-8970-535fcabc16a0/scratchpad/resolver-cache";

/** The day the policy is measured against: ages and cooldowns are counted from it. */
export const NOW = new Date(process.env.RESOLVER_NOW ?? "2026-10-30T12:00:00Z");

export const OUT = join(import.meta.dirname, "out");

/**
 * uv 0.13.4 (2026-10-20, 10 days old on 2026-10-30) with Python 3.12, on Debian trixie. The
 * bypass rule's own case: 0.13.1, the newest past 14 days, has GHSA-hq85-5cpj-mr62 (critical,
 * its bundled CA store), and 0.13.4 is the earliest release that fixes it.
 */
export const UV_IMAGE =
  "ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim@sha256:0d42b7b065ada5139af940bf3fb178b926675450e786badc854c9f73736cc6c4";

/** glibc 2.35, Ubuntu 22.04's, which the vLLM and SGLang images run on. */
export const PLATFORM = "x86_64-manylinux_2_35";

export interface Artifact {
  name: string;
  version: string;
  url: string;
  sha256: string;
  size: number | null;
  publishedAt: string | null;
}

export interface Advisory {
  id: string;
  aliases: string[];
  package: string;
  version: string;
  severity: string;
  summary: string;
  fixed: string | null;
  source: string;
}

export interface Resolution {
  engine: string;
  format: "github-release" | "python-wheels" | "oci-image";
  resolvedAt: string;
  artifacts: Artifact[];
  checks: {
    minimumAgeDays: number;
    age: Record<string, unknown>;
    advisories: Advisory[];
    provenance: Record<string, unknown>;
  };
}

export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

let requests = 0;
/** How many requests went to the network in this process, per host. */
export const network: Record<string, number> = {};

/** `fetch`, with the response cached on disk by method, URL, Accept header and body. */
export async function cachedFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<CachedResponse> {
  const method = init.method ?? "GET";
  const key = createHash("sha256")
    .update(`${method} ${url} ${init.headers?.Accept ?? ""} ${init.body ?? ""}`)
    .digest("hex");
  const file = join(CACHE, "http", `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  requests++;
  const host = new URL(url).host;
  network[host] = (network[host] ?? 0) + 1;
  const response = await fetch(url, { method, headers: init.headers, body: init.body });
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) headers[name] = value;
  const cached = {
    status: response.status,
    headers,
    body: method === "HEAD" ? "" : await response.text(),
  };
  // Rate limits and server errors are not cached, so a rerun tries again.
  if (response.status < 500 && response.status !== 429 && response.status !== 403) {
    mkdirSync(join(CACHE, "http"), { recursive: true });
    writeFileSync(file, JSON.stringify(cached));
  }
  return cached;
}

/** A JSON GET; `null` for a 404. Throws on any other failure. */
export async function getJson<T = any>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const response = await cachedFetch(url, { headers: { Accept: "application/json", ...headers } });
  if (response.status === 404) return null;
  if (response.status !== 200)
    throw new Error(`GET ${url}: ${response.status} ${response.body.slice(0, 200)}`);
  return JSON.parse(response.body);
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** GitHub's REST API, anonymously: 60 requests an hour, hence the cache. */
export function github<T = any>(path: string): Promise<T | null> {
  return getJson<T>(`https://api.github.com${path}`, GITHUB_HEADERS);
}

/** Days between `date` and NOW. */
export function ageDays(date: string | null): number | null {
  if (!date) return null;
  return (NOW.getTime() - new Date(date).getTime()) / 86_400_000;
}

/** How many of `dates` are younger than each cooldown: what each would hold back. */
export function cooldownCounts(
  dates: (string | null)[],
  days = [7, 14, 30],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of days) {
    counts[`${d}d`] = dates.filter((date) => {
      const age = ageDays(date);
      return age !== null && age < d;
    }).length;
  }
  counts.unknown = dates.filter((date) => date === null).length;
  return counts;
}

/** A PEP 440 version, reduced to what ordering needs. Local versions (`+cpu`) are ignored. */
function parseVersion(version: string) {
  const v = version.toLowerCase().replace(/^v/, "").split("+")[0];
  const m = v.match(
    /^(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*))?(?:[-_.]?(?:post|rev|r)[-_.]?(\d*))?(?:[-_.]?dev[-_.]?(\d*))?$/,
  );
  if (!m) return null;
  const pre = m[3] ? (({ a: 0, alpha: 0, b: 1, beta: 1 } as Record<string, number>)[m[3]] ?? 2) : 3;
  return {
    epoch: Number(m[1] ?? 0),
    release: m[2].split(".").map(Number),
    // A dev release without pre comes before the pre releases.
    pre: m[3] ? [pre, Number(m[4] || 0)] : m[6] !== undefined && !m[5] ? [-1, 0] : [3, 0],
    post: m[5] !== undefined ? Number(m[5] || 0) : -1,
    dev: m[6] !== undefined ? Number(m[6] || 0) : Number.POSITIVE_INFINITY,
  };
}

/** Negative, zero or positive as `a` is older than, equal to or newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return a.localeCompare(b, undefined, { numeric: true });
  if (x.epoch !== y.epoch) return x.epoch - y.epoch;
  const n = Math.max(x.release.length, y.release.length);
  for (let i = 0; i < n; i++) {
    const d = (x.release[i] ?? 0) - (y.release[i] ?? 0);
    if (d) return d;
  }
  for (const [p, q] of [
    [x.pre[0], y.pre[0]],
    [x.pre[1], y.pre[1]],
    [x.post, y.post],
    [x.dev, y.dev],
  ]) {
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export interface OsvQuery {
  name: string;
  ecosystem: string;
  version: string;
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name: string; ecosystem: string };
    ranges?: { type: string; events: Record<string, string>[] }[];
    versions?: string[];
    database_specific?: { severity?: string };
    ecosystem_specific?: { severity?: string };
  }[];
}

/** OSV's normalized name for a PyPI package. */
export function pypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** The earliest version that `vuln` says fixes `version` of `name`, if any. */
function earliestFix(vuln: OsvVuln, q: OsvQuery): string | null {
  let best: string | null = null;
  for (const affected of vuln.affected ?? []) {
    const pkg = affected.package;
    if (!pkg || pkg.ecosystem !== q.ecosystem) continue;
    if (q.ecosystem === "PyPI" ? pypiName(pkg.name) !== pypiName(q.name) : pkg.name !== q.name)
      continue;
    for (const range of affected.ranges ?? []) {
      if (range.type === "GIT") continue;
      let introduced: string | null = null;
      for (const event of range.events) {
        if (event.introduced !== undefined) introduced = event.introduced;
        const fixed = event.fixed;
        if (fixed === undefined) continue;
        const inRange =
          (introduced === "0" ||
            introduced === null ||
            compareVersions(introduced, q.version) <= 0) &&
          compareVersions(q.version, fixed) < 0;
        if (inRange && (!best || compareVersions(fixed, best) < 0)) best = fixed;
      }
    }
  }
  return best;
}

/** A CVSS 3.x vector's base score, by the specification's formula. */
export function cvss3(vector: string): number | null {
  const m = Object.fromEntries(
    vector
      .split("/")
      .slice(1)
      .map((p) => p.split(":")),
  );
  const w: Record<string, Record<string, number>> = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    C: { H: 0.56, L: 0.22, N: 0 },
  };
  if (!m.AV || !m.S) return null;
  const changed = m.S === "C";
  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR as "N"];
  const iss = 1 - (1 - w.C[m.C]) * (1 - w.C[m.I]) * (1 - w.C[m.A]);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * w.AV[m.AV] * w.AC[m.AC] * pr * w.UI[m.UI];
  if (impact <= 0) return 0;
  const raw = changed
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return Math.ceil(raw * 10 - 1e-9) / 10;
}

function severityOf(vuln: OsvVuln): string {
  const named = vuln.database_specific?.severity ?? vuln.affected?.[0]?.database_specific?.severity;
  if (named) return named.toUpperCase().replace("MEDIUM", "MODERATE");
  const v3 = vuln.severity?.find((s) => s.type === "CVSS_V3");
  const score = v3 ? cvss3(v3.score) : null;
  if (score === null)
    return vuln.severity?.length ? `UNSCORED (${vuln.severity[0].type})` : "UNKNOWN";
  return score >= 9
    ? "CRITICAL"
    : score >= 7
      ? "HIGH"
      : score >= 4
        ? "MODERATE"
        : score > 0
          ? "LOW"
          : "NONE";
}

/**
 * Known vulnerabilities from OSV.dev: one `/v1/querybatch` for all `queries`, then each
 * vulnerability's record. Records that alias each other (a PYSEC and its GHSA) count once.
 */
export async function osvAdvisories(queries: OsvQuery[]): Promise<Advisory[]> {
  const advisories: Advisory[] = [];
  for (let i = 0; i < queries.length; i += 1000) {
    const chunk = queries.slice(i, i + 1000);
    const response = await cachedFetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        queries: chunk.map((q) => ({
          package: { name: q.name, ecosystem: q.ecosystem },
          version: q.version,
        })),
      }),
    });
    if (response.status !== 200)
      throw new Error(`OSV querybatch: ${response.status} ${response.body}`);
    const { results } = JSON.parse(response.body) as {
      results: { vulns?: { id: string }[]; next_page_token?: string }[];
    };
    for (const [j, result] of results.entries()) {
      const q = chunk[j];
      if (result.next_page_token)
        console.error(`OSV: more results for ${q.name} than one page; not followed.`);
      const seen = new Set<string>();
      const records: OsvVuln[] = [];
      for (const { id } of result.vulns ?? []) {
        const vuln = await getJson<OsvVuln>(`https://api.osv.dev/v1/vulns/${id}`);
        if (vuln) records.push(vuln);
      }
      // GHSA records first: they carry a severity that PYSEC ones often lack.
      records.sort((a, b) => Number(b.id.startsWith("GHSA")) - Number(a.id.startsWith("GHSA")));
      for (const vuln of records) {
        const ids = [vuln.id, ...(vuln.aliases ?? [])];
        if (ids.some((id) => seen.has(id))) continue;
        for (const id of ids) seen.add(id);
        advisories.push({
          id: vuln.id,
          aliases: vuln.aliases ?? [],
          package: q.name,
          version: q.version,
          severity: severityOf(vuln),
          summary: (vuln.summary ?? vuln.details ?? "").split("\n")[0].slice(0, 160),
          fixed: earliestFix(vuln, q),
          source: "osv.dev",
        });
      }
    }
  }
  return advisories;
}

/**
 * GitHub's reviewed advisories that affect any of `packages` (`name@version`), in one request
 * per 100 results: `GET /advisories?ecosystem=&affects=`.
 */
export async function githubAdvisories(ecosystem: string, packages: string[]): Promise<Advisory[]> {
  const out: Advisory[] = [];
  const affects = packages.map(encodeURIComponent).join(",");
  const list = await github<any[]>(
    `/advisories?ecosystem=${ecosystem}&per_page=100&affects=${affects}`,
  );
  for (const a of list ?? []) {
    for (const v of a.vulnerabilities ?? []) {
      const hit = packages.find((p) => p.slice(0, p.lastIndexOf("@")) === v.package?.name);
      if (!hit) continue;
      out.push({
        id: a.ghsa_id,
        aliases: a.cve_id ? [a.cve_id] : [],
        package: v.package.name,
        version: hit.slice(hit.lastIndexOf("@") + 1),
        severity: String(a.severity).toUpperCase().replace("MEDIUM", "MODERATE"),
        summary: a.summary,
        fixed: v.first_patched_version ?? null,
        source: "github",
      });
    }
  }
  if ((list?.length ?? 0) === 100)
    console.error("GitHub advisories: 100 results; the next page was not read.");
  return out;
}

export function writeResolution(resolution: Resolution, name = resolution.engine): string {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(resolution, null, 2)}\n`);
  return file;
}

export function requestCount(): number {
  return requests;
}
