import { createHash } from "node:crypto";
import {
  type AdvisoryDatabase,
  isOsvId,
  type OsvEvent,
  type OsvPackage,
  type OsvQuery,
  type OsvRecord,
  OsvUnavailable,
} from "./osv.ts";

// The release policy that `open-key` applies to each artifact a pod runs, before creating the pod:
// the recommendations A, B and C of the investigation of multi-service pods, and decision 7 of
// the plan to start pods from official engine images (docs/plans/).

/** A release a pod runs: an engine's image, its engine package, Node. */
export interface ReleaseArtifact {
  /** Such as "docker.io/ollama/ollama" or "node". */
  name: string;
  version: string;
  /** ISO 8601. */
  publishedAt: string;
  /** Where its advisories live, such as `{ ecosystem: "PyPI", package: "vllm" }`. */
  osv?: { ecosystem: string; package: string };
  /** The version this pin replaced, for the security fix bypass. */
  replaces?: string;
  /** Recorded, never required. */
  provenance?: Record<string, string | boolean>;
}

/** An advisory accepted, by its ID or one of its aliases, with the reason it is accepted. */
export interface AdvisoryException {
  id: string;
  reason: string;
}

/** A release must have been published this long ago, unless the security fix bypass admits it. */
export const MINIMUM_AGE_DAYS = 7;

/** How long a passing result stands in for OSV.dev when it does not answer. */
export const CACHE_HOURS = 24;

/** Bumped when a rule changes, so a cached result of the older rules is not used. */
const POLICY_VERSION = 1;

export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";

const RANK: Record<Severity, number> = { unknown: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/** High and critical block; moderate, low and unknown are warnings. */
export function isBlocking(severity: Severity): boolean {
  return RANK[severity] >= RANK.high;
}

/** An advisory affecting an artifact's version, its records that alias each other taken as one. */
export interface FoundAdvisory {
  /** Its GHSA ID when it has one, which carries a severity most often. */
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  /** Where the severity comes from, such as "GHSA-… database_specific" or "CVSS_V3 8.1". */
  severityFrom: string;
  /** The versions that fix it for this version, earliest first; empty when none does. */
  fixed: string[];
  /** The reason of the exception that accepts it. */
  acceptedBecause?: string;
}

export type Verdict = "pass" | "warn" | "block";

/** One line of a verdict, in plain English. */
export interface Reason {
  level: "block" | "warning" | "note";
  text: string;
}

export interface ArtifactCheck {
  name: string;
  version: string;
  publishedAt: string;
  /** Days since its publication when checked; null when the date cannot be read. */
  ageDays: number | null;
  advisories: FoundAdvisory[];
  /** The exceptions that accepted one of its advisories. */
  exceptions: AdvisoryException[];
  /** When the bypass admitted it under the minimum age: the advisory of `replaces` it fixes. */
  bypass?: { replaces: string; advisory: string };
  provenance?: Record<string, string | boolean>;
  verdict: Verdict;
  reasons: Reason[];
}

export interface ReleaseCheck {
  verdict: Verdict;
  /** When this check ran (ISO 8601). */
  checkedAt: string;
  /** "cache" when OSV.dev did not answer and a passing result of the last 24 hours stood in. */
  source: "live" | "cache";
  /** For a result from the cache: when it was checked against OSV.dev. */
  cachedFrom?: string;
  artifacts: ArtifactCheck[];
  /** Every artifact's reasons, each naming its artifact, then those of the whole check. Blocks first. */
  reasons: Reason[];
}

/** Where passing results are kept, keyed by `releaseCheckKey`. */
export interface ReleaseCheckCache {
  get(key: string): Promise<ReleaseCheck | undefined>;
  set(key: string, result: ReleaseCheck): Promise<void>;
}

/** A cache in memory, for tests. */
export class MemoryReleaseCheckCache implements ReleaseCheckCache {
  readonly entries = new Map<string, ReleaseCheck>();

  async get(key: string): Promise<ReleaseCheck | undefined> {
    const entry = this.entries.get(key);
    return entry && structuredClone(entry);
  }

  async set(key: string, result: ReleaseCheck): Promise<void> {
    this.entries.set(key, structuredClone(result));
  }
}

export interface ReleaseCheckOptions {
  now: Date;
  exceptions: readonly AdvisoryException[];
  osv: AdvisoryDatabase;
  cache: ReleaseCheckCache;
}

/** The cache's key: a SHA-256 of the policy's version, the artifacts and the exceptions. */
export function releaseCheckKey(
  artifacts: readonly ReleaseArtifact[],
  exceptions: readonly AdvisoryException[],
): string {
  const canonical = {
    policy: POLICY_VERSION,
    artifacts: artifacts
      .map((a) => [
        a.name,
        a.version,
        a.publishedAt,
        a.osv?.ecosystem ?? null,
        a.osv?.package ?? null,
        a.replaces ?? null,
        Object.entries(a.provenance ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
      ])
      .sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)),
    exceptions: exceptions
      .map((e) => [e.id, e.reason])
      .sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Checks each artifact against the release policy:
 * - It must be at least 7 days old, unless `replaces` is set and it is the earliest release that
 *   fixes a high or critical advisory affecting `replaces`.
 * - Its advisories of severity high or critical block, unless an exception names the advisory or
 *   one of its aliases. Moderate, low and those without a severity are warnings.
 * - Its provenance is recorded only.
 * When OSV.dev does not answer, a passing result of the same artifacts and exceptions from the
 * last 24 hours passes with a warning; nothing else does.
 */
export async function checkReleases(
  artifacts: readonly ReleaseArtifact[],
  options: ReleaseCheckOptions,
): Promise<ReleaseCheck> {
  const { now, osv, cache } = options;
  const exceptions = options.exceptions;
  const key = releaseCheckKey(artifacts, exceptions);
  const ages = artifacts.map((artifact) => ageDays(artifact.publishedAt, now));

  const queries: OsvQuery[] = [];
  const seen = new Map<string, number>();
  const queryOf = (pkg: OsvPackage, version: string): number => {
    const query = { package: pkg, version: osvVersion(version) };
    const id = JSON.stringify(query);
    let index = seen.get(id);
    if (index === undefined) {
      index = queries.push(query) - 1;
      seen.set(id, index);
    }
    return index;
  };
  const plans = artifacts.map((artifact, i) => {
    if (!artifact.osv) return {};
    const pkg = { ecosystem: artifact.osv.ecosystem, name: artifact.osv.package };
    const young = (ages[i] ?? null) !== null && (ages[i] as number) < MINIMUM_AGE_DAYS;
    return {
      own: queryOf(pkg, artifact.version),
      ...(young && artifact.replaces ? { replaced: queryOf(pkg, artifact.replaces) } : {}),
    };
  });

  let found: FoundAdvisory[][] | undefined;
  let failure: string | undefined;
  if (queries.length > 0) {
    try {
      found = await lookUp(osv, queries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof OsvUnavailable) {
        const cached = await fresh(cache, key, now);
        if (cached) {
          return {
            ...cached,
            verdict: "warn",
            checkedAt: now.toISOString(),
            source: "cache",
            cachedFrom: cached.checkedAt,
            reasons: [
              ...cached.reasons.filter((r) => r.level !== "note"),
              {
                level: "warning",
                text: `${message} The same releases passed at ${cached.checkedAt}, within the last ${CACHE_HOURS} hours, so that result stands.`,
              },
              ...cached.reasons.filter((r) => r.level === "note"),
            ],
          };
        }
        failure = `${message} No passing check of the same releases and exceptions from the last ${CACHE_HOURS} hours is cached, so they cannot be checked; try again later.`;
      } else {
        failure = `OSV.dev's advisories could not be read: ${message}`;
      }
    }
  }

  const used = new Set<AdvisoryException>();
  const checks = artifacts.map((artifact, i) =>
    checkArtifact(artifact, ages[i] ?? null, plans[i] ?? {}, found, exceptions, used),
  );
  const general: Reason[] = [];
  if (failure) general.push({ level: "block", text: failure });
  for (const exception of exceptions) {
    if (exception.reason.trim() === "") {
      general.push({
        level: "block",
        text: `The exception for ${exception.id} gives no reason; each exception says why its advisory is accepted.`,
      });
    } else if (!failure && !used.has(exception)) {
      general.push({
        level: "note",
        text: `The exception for ${exception.id} matches no advisory of these releases, so it can go.`,
      });
    }
  }
  const reasons = [
    ...checks.flatMap((check) =>
      check.reasons.map((r) => ({ level: r.level, text: `${label(check)}: ${r.text}` })),
    ),
    ...general,
  ];
  const result: ReleaseCheck = {
    verdict: verdictOf(reasons),
    checkedAt: now.toISOString(),
    source: "live",
    artifacts: checks,
    reasons: sortReasons(reasons),
  };
  if (result.verdict !== "block") {
    try {
      await cache.set(key, result);
    } catch (error) {
      result.reasons.push({
        level: "note",
        text: `This result could not be cached (${error instanceof Error ? error.message : error}), so it cannot stand in for OSV.dev if it does not answer later.`,
      });
    }
  }
  return result;
}

/** The cached result for `key`, when it passed against OSV.dev within the last 24 hours. */
async function fresh(
  cache: ReleaseCheckCache,
  key: string,
  now: Date,
): Promise<ReleaseCheck | undefined> {
  let cached: ReleaseCheck | undefined;
  try {
    cached = await cache.get(key);
  } catch {
    return undefined;
  }
  if (!cached || cached.verdict === "block" || cached.source !== "live") return undefined;
  const age = now.getTime() - Date.parse(cached.checkedAt);
  return age >= 0 && age <= CACHE_HOURS * 3_600_000 ? cached : undefined;
}

function checkArtifact(
  artifact: ReleaseArtifact,
  age: number | null,
  plan: { own?: number; replaced?: number },
  found: FoundAdvisory[][] | undefined,
  exceptions: readonly AdvisoryException[],
  used: Set<AdvisoryException>,
): ArtifactCheck {
  const reasons: Reason[] = [];
  const accepted: AdvisoryException[] = [];
  let bypass: ArtifactCheck["bypass"];

  // Minimum age, with the security fix bypass.
  if (age === null) {
    reasons.push({
      level: "block",
      text: `its publication date, "${artifact.publishedAt}", cannot be read, so its age is unknown.`,
    });
  } else if (age < MINIMUM_AGE_DAYS) {
    const young = `it was published ${formatAge(age)} ago, under the minimum age of ${MINIMUM_AGE_DAYS} days`;
    if (!artifact.replaces) {
      reasons.push({
        level: "block",
        text: `${young}. Pin an older release, or set the release it replaces when it fixes a high or critical advisory of that release.`,
      });
    } else if (!artifact.osv) {
      reasons.push({
        level: "block",
        text: `${young}, and with no advisory database named for it, nothing shows that it fixes an advisory of ${artifact.replaces}.`,
      });
    } else if (found && plan.replaced !== undefined) {
      const fixes = (found[plan.replaced] ?? []).filter((a) => isBlocking(a.severity));
      const justified = fixes.find(
        (a) => a.fixed[0] !== undefined && compareVersions(a.fixed[0], artifact.version) === 0,
      );
      if (justified) {
        bypass = { replaces: artifact.replaces, advisory: justified.id };
        reasons.push({
          level: "note",
          text: `${young}, but passes: it is the earliest release that fixes ${justified.id} (${justified.severity}) of ${artifact.replaces}, which it replaces.`,
        });
      } else {
        const earliest = fixes
          .filter((a) => a.fixed[0] !== undefined)
          .map((a) => `${a.id} is fixed first in ${a.fixed[0]}`);
        reasons.push({
          level: "block",
          text: `${young}, and it is not the earliest release that fixes a high or critical advisory of ${artifact.replaces}, which it replaces: ${earliest.length > 0 ? `${earliest.join("; ")}.` : `${artifact.replaces} has none with a fix.`}`,
        });
      }
    } else {
      // OSV.dev did not answer: the general reason says so.
      reasons.push({
        level: "block",
        text: `${young}, and whether it fixes an advisory of ${artifact.replaces} could not be checked.`,
      });
    }
  }

  // Advisories.
  const advisories = plan.own !== undefined && found ? (found[plan.own] ?? []) : [];
  for (const advisory of advisories) {
    const exception = exceptions.find((e) => e.reason.trim() !== "" && matches(e.id, advisory));
    const named = `${advisory.id} (${advisory.severity === "unknown" ? "no severity" : advisory.severity}${advisory.aliases.length > 0 ? `, also ${advisory.aliases.join(", ")}` : ""})`;
    const summary = advisory.summary ? `: ${advisory.summary}` : "";
    const fix =
      advisory.fixed[0] !== undefined ? `fixed in ${advisory.fixed[0]}` : "no release fixes it";
    const remedy =
      advisory.fixed[0] !== undefined
        ? `It is fixed in ${advisory.fixed[0]}; pin that release`
        : "No release fixes it; pin a release it does not affect";
    if (exception) {
      used.add(exception);
      if (!accepted.includes(exception)) accepted.push(exception);
      advisory.acceptedBecause = exception.reason;
      reasons.push({
        level: "note",
        text: `${named} is accepted by the exception for ${exception.id}: ${exception.reason}`,
      });
    } else if (isBlocking(advisory.severity)) {
      reasons.push({
        level: "block",
        text: `it has ${named}${summary}. ${remedy}, or add an exception for ${advisory.id} with its reason.`,
      });
    } else if (advisory.severity === "unknown") {
      reasons.push({
        level: "warning",
        text: `it has ${named}${summary}. ${advisory.severityFrom}, so review it by hand; ${fix}.`,
      });
    } else {
      reasons.push({ level: "warning", text: `it has ${named}${summary}; ${fix}.` });
    }
  }
  if (!artifact.osv) {
    reasons.push({
      level: "note",
      text: "no advisory database is named for it, so OSV.dev was not asked; its advisories are checked by hand when it is pinned.",
    });
  } else if (!found) {
    reasons.push({ level: "block", text: "its advisories could not be read from OSV.dev." });
  }

  return {
    name: artifact.name,
    version: artifact.version,
    publishedAt: artifact.publishedAt,
    ageDays: age === null ? null : Math.round(age * 100) / 100,
    advisories,
    exceptions: accepted,
    ...(bypass ? { bypass } : {}),
    ...(artifact.provenance ? { provenance: artifact.provenance } : {}),
    verdict: verdictOf(reasons),
    reasons: sortReasons(reasons),
  };
}

/** Whether an exception's ID names the advisory or one of its aliases; IDs ignore case. */
function matches(id: string, advisory: FoundAdvisory): boolean {
  const wanted = id.trim().toUpperCase();
  return [advisory.id, ...advisory.aliases].some((other) => other.toUpperCase() === wanted);
}

function verdictOf(reasons: readonly Reason[]): Verdict {
  if (reasons.some((r) => r.level === "block")) return "block";
  return reasons.some((r) => r.level === "warning") ? "warn" : "pass";
}

function sortReasons(reasons: readonly Reason[]): Reason[] {
  const order = { block: 0, warning: 1, note: 2 };
  return [...reasons].sort((a, b) => order[a.level] - order[b.level]);
}

function label(check: { name: string; version: string }): string {
  return `${check.name} ${check.version}`;
}

function ageDays(publishedAt: string, now: Date): number | null {
  const published = Date.parse(publishedAt);
  return Number.isNaN(published) ? null : (now.getTime() - published) / 86_400_000;
}

function formatAge(days: number): string {
  if (days < 1) {
    const hours = Math.max(0, Math.floor(days * 24));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${Math.floor(days * 10) / 10} days`;
}

/** OSV's events carry no leading "v" (`0.32.0`, Go's included), so the query drops it. */
function osvVersion(version: string): string {
  return version.replace(/^v(?=\d)/, "");
}

/** At most this many aliases are read for a record that has no severity of its own. */
const ALIASES_READ = 4;

/**
 * The advisories affecting each query's version: one batch, the records it names, then, for a
 * record without a severity (Go's GO-* records have none), the records of its aliases.
 */
async function lookUp(
  osv: AdvisoryDatabase,
  queries: readonly OsvQuery[],
): Promise<FoundAdvisory[][]> {
  const ids = await osv.query(queries);
  const records = await osv.records([...new Set(ids.flat())]);
  const aliasIds = new Set<string>();
  for (const record of records.values()) {
    if (record.withdrawn || severityOf(record).severity !== "unknown") continue;
    for (const alias of preferred(record.aliases ?? []).slice(0, ALIASES_READ)) {
      if (!records.has(alias) && isOsvId(alias)) aliasIds.add(alias);
    }
  }
  const aliases = aliasIds.size > 0 ? await osv.records([...aliasIds]) : new Map();
  return queries.map((query, i) =>
    group(
      query,
      (ids[i] ?? []).flatMap((id) => {
        const record = records.get(id);
        return record && !record.withdrawn ? [record] : [];
      }),
      aliases,
    ),
  );
}

/** GHSA IDs first, since GitHub's records carry a severity; then CVEs; then the rest. */
function preferred(ids: readonly string[]): string[] {
  const rank = (id: string) => (id.startsWith("GHSA-") ? 0 : id.startsWith("CVE-") ? 1 : 2);
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** The records of one query, those that alias each other taken as one advisory. */
function group(
  query: OsvQuery,
  records: readonly OsvRecord[],
  aliasRecords: ReadonlyMap<string, OsvRecord>,
): FoundAdvisory[] {
  const groups: OsvRecord[][] = [];
  for (const record of records) {
    const names = new Set([record.id, ...(record.aliases ?? [])]);
    const joined = groups.filter((g) =>
      g.some((other) => names.has(other.id) || (other.aliases ?? []).includes(record.id)),
    );
    const merged = [...joined.flat(), record];
    for (const g of joined) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  const advisories = groups.map((members): FoundAdvisory => {
    const [primary] = preferred(members.map((m) => m.id));
    const head = members.find((m) => m.id === primary) as OsvRecord;
    const names = new Set(members.flatMap((m) => [m.id, ...(m.aliases ?? [])]));
    names.delete(head.id);
    let severity = strongest(members.map(severityOf));
    const outside = [...names].filter((name) => !members.some((m) => m.id === name));
    if (severity.severity === "unknown" && outside.length > 0) {
      const fromAliases = strongest(
        outside.flatMap((alias) => {
          const record = aliasRecords.get(alias);
          if (!record) return [];
          const found = severityOf(record);
          return found.severity === "unknown"
            ? []
            : [{ ...found, from: `${found.from}, an alias` }];
        }),
      );
      severity =
        fromAliases.severity !== "unknown"
          ? fromAliases
          : { severity: "unknown", from: `${severity.from}, and none of its aliases has one` };
    }
    const fixed = [...new Set(members.flatMap((m) => fixesFor(m, query)))].sort(compareVersions);
    return {
      id: head.id,
      aliases: [...names].sort(),
      summary: firstLine(head.summary ?? members.find((m) => m.summary)?.summary ?? head.details),
      severity: severity.severity,
      severityFrom: severity.from,
      fixed,
    };
  });
  // The most severe first, then by ID.
  return advisories.sort(
    (a, b) => RANK[b.severity] - RANK[a.severity] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function firstLine(text: string | undefined): string {
  return ((text ?? "").split("\n")[0] ?? "").trim().slice(0, 200).replace(/\.$/, "");
}

interface SeverityFound {
  severity: Severity;
  from: string;
  /** Named by the database, rather than computed from a CVSS vector. */
  named?: boolean;
}

/**
 * Of records that alias each other, the severity a database names (GitHub's reviewed one), the
 * highest when several do; a computed one only when none names it.
 */
function strongest(found: readonly SeverityFound[]): SeverityFound {
  let best: SeverityFound = { severity: "unknown", from: "It carries no severity" };
  for (const f of found) {
    const better =
      Number(f.named ?? false) - Number(best.named ?? false) ||
      RANK[f.severity] - RANK[best.severity];
    if (better > 0) best = f;
    else if (best.severity === "unknown" && f.severity === "unknown" && f.from !== best.from) {
      best = f;
    }
  }
  return best;
}

/** A severity named by a database, such as GitHub's "MODERATE". */
function named(value: unknown): Severity | undefined {
  if (typeof value !== "string") return undefined;
  const word = value.trim().toUpperCase();
  if (word === "CRITICAL") return "critical";
  if (word === "HIGH") return "high";
  if (word === "MODERATE" || word === "MEDIUM") return "moderate";
  if (word === "LOW") return "low";
  return undefined;
}

/**
 * A record's severity: the one its database names in `database_specific` (GitHub's records), or
 * in an `affected` entry's, else a CVSS 3 score computed from its vector, else an Ubuntu
 * priority. Unknown otherwise: no severity, or only vectors Codeman does not score (CVSS 2, 4).
 */
export function severityOf(record: OsvRecord): SeverityFound {
  const top = named(record.database_specific?.severity);
  if (top) return { severity: top, from: `${record.id} database_specific`, named: true };
  let best: SeverityFound | undefined;
  for (const affected of record.affected ?? []) {
    for (const value of [
      affected.database_specific?.severity,
      affected.ecosystem_specific?.severity,
    ]) {
      const severity = named(value);
      if (severity && (!best || RANK[severity] > RANK[best.severity])) {
        best = { severity, from: `${record.id} affected severity`, named: true };
      }
    }
  }
  if (best) return best;
  const vectors = record.severity ?? [];
  for (const { type, score } of vectors) {
    if ((type === "CVSS_V3" || score?.startsWith("CVSS:3.")) && typeof score === "string") {
      const base = cvss3(score);
      if (base !== null) {
        return { severity: fromScore(base), from: `${record.id} CVSS_V3 ${base.toFixed(1)}` };
      }
    }
  }
  for (const { type, score } of vectors) {
    const severity = type === "Ubuntu" ? named(score) : undefined;
    if (severity) return { severity, from: `${record.id} Ubuntu priority`, named: true };
  }
  if (vectors.length > 0) {
    const types = [...new Set(vectors.map((v) => v.type ?? "unknown"))].join(", ");
    return { severity: "unknown", from: `Its ${types} vector is not one Codeman scores` };
  }
  return { severity: "unknown", from: "It carries no severity" };
}

function fromScore(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "moderate";
  return "low";
}

/** CVSS 3.x's Roundup: the smallest number of one decimal at or above `value`. */
function roundUp(value: number): number {
  const scaled = Math.round(value * 100_000);
  return scaled % 10_000 === 0 ? scaled / 100_000 : (Math.floor(scaled / 10_000) + 1) / 10;
}

/** A CVSS 3.0 or 3.1 vector's base score, as the specification computes it; null if invalid. */
export function cvss3(vector: string): number | null {
  const parts = vector.split("/");
  if (!/^CVSS:3\.[01]$/.test(parts[0] ?? "")) return null;
  const m = new Map(parts.slice(1).map((p) => p.split(":") as [string, string]));
  const pick = (metric: string, weights: Record<string, number>) => {
    const value = m.get(metric);
    return value !== undefined && value in weights ? weights[value] : undefined;
  };
  const scope = m.get("S");
  if (scope !== "U" && scope !== "C") return null;
  const changed = scope === "C";
  const cia = { H: 0.56, L: 0.22, N: 0 };
  const av = pick("AV", { N: 0.85, A: 0.62, L: 0.55, P: 0.2 });
  const ac = pick("AC", { L: 0.77, H: 0.44 });
  const pr = pick("PR", { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 });
  const ui = pick("UI", { N: 0.85, R: 0.62 });
  const c = pick("C", cia);
  const i = pick("I", cia);
  const a = pick("A", cia);
  if ([av, ac, pr, ui, c, i, a].some((w) => w === undefined)) return null;
  const iss = 1 - (1 - (c as number)) * (1 - (i as number)) * (1 - (a as number));
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * (av as number) * (ac as number) * (pr as number) * (ui as number);
  return roundUp(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
}

/** OSV's normalized name for a PyPI package (PEP 503). */
function pypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function samePackage(affected: { name?: string; ecosystem?: string }, pkg: OsvPackage): boolean {
  if (affected.ecosystem !== pkg.ecosystem || typeof affected.name !== "string") return false;
  return pkg.ecosystem === "PyPI"
    ? pypiName(affected.name) === pypiName(pkg.name)
    : affected.name === pkg.name;
}

/**
 * The versions that fix the query's version, from the `fixed` events of the record's ranges for
 * its package: in each range the version falls in, the first `fixed` event above it
 * (docs/web/osv/open-source-vulnerability-format.md#affected-versions).
 */
export function fixesFor(record: OsvRecord, query: OsvQuery): string[] {
  const fixes: string[] = [];
  let listed = false;
  const above: string[] = [];
  for (const affected of record.affected ?? []) {
    if (!affected.package || !samePackage(affected.package, query.package)) continue;
    if (affected.versions?.some((v) => compareVersions(v, query.version) === 0)) listed = true;
    for (const range of affected.ranges ?? []) {
      if (range.type === "GIT") continue;
      const events = (range.events ?? []).flatMap((event) => eventOf(event));
      events.sort((x, y) => compareEvent(x.at, y.at));
      for (const event of events) {
        if (event.kind === "fixed" && compareEvent(event.at, query.version) > 0) {
          above.push(event.at);
        }
      }
      let inside = false;
      for (const event of events) {
        const order = compareEvent(event.at, query.version);
        if (order < 0 || (order === 0 && event.kind !== "last_affected")) {
          if (event.kind === "introduced") inside = true;
          else if (event.kind === "fixed" || event.kind === "last_affected") inside = false;
          continue;
        }
        if (order === 0) break; // last_affected at the version: no known fix in this range.
        if (inside && event.kind === "fixed") fixes.push(event.at);
        if (event.kind !== "limit") break;
      }
    }
  }
  // OSV said the version is affected; when only its `versions` list shows it, any later fix.
  const all = fixes.length > 0 ? fixes : listed ? above : [];
  return [...new Set(all)].sort(compareVersions);
}

function eventOf(event: OsvEvent): { kind: keyof OsvEvent; at: string }[] {
  return (["introduced", "fixed", "last_affected", "limit"] as const).flatMap((kind) =>
    typeof event[kind] === "string" ? [{ kind, at: event[kind] as string }] : [],
  );
}

/** Versions in order, where "0" comes before every other. */
function compareEvent(a: string, b: string): number {
  if (a === "0" || b === "0") return a === b ? 0 : a === "0" ? -1 : 1;
  return compareVersions(a, b);
}

/** A PEP 440 or semantic version, reduced to what ordering needs; local versions are ignored. */
function parseVersion(version: string) {
  const v = version.trim().toLowerCase().replace(/^v/, "").split("+")[0] ?? "";
  const m = v.match(
    /^(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*))?(?:[-_.]?(?:post|rev|r)[-_.]?(\d*))?(?:[-_.]?dev[-_.]?(\d*))?$/,
  );
  if (!m) return null;
  const pre = m[3] ? (({ a: 0, alpha: 0, b: 1, beta: 1 } as Record<string, number>)[m[3]] ?? 2) : 3;
  return {
    epoch: Number(m[1] ?? 0),
    release: (m[2] ?? "0").split(".").map(Number),
    // A dev release without a pre release comes before the pre releases.
    pre: m[3]
      ? [pre, Number(m[4] || 0)]
      : m[6] !== undefined && m[5] === undefined
        ? [-1, 0]
        : [3, 0],
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
  const pairs: [number, number][] = [
    [x.pre[0] ?? 0, y.pre[0] ?? 0],
    [x.pre[1] ?? 0, y.pre[1] ?? 0],
    [x.post, y.post],
    [x.dev, y.dev],
  ];
  for (const [p, q] of pairs) if (p !== q) return p < q ? -1 : 1;
  return 0;
}
