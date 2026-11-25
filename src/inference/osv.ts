import type { Fetch } from "../budget.ts";

/** OSV.dev's API (docs/web/osv/api.md). */
export const OSV_API = "https://api.osv.dev";

/** A package as OSV names it: `{ ecosystem: "PyPI", name: "vllm" }` (docs/web/osv/post-v1-query.md). */
export interface OsvPackage {
  ecosystem: string;
  name: string;
}

export interface OsvQuery {
  package: OsvPackage;
  version: string;
}

/** One event of a range's timeline: a single key (docs/web/osv/open-source-vulnerability-format.md). */
export type OsvEvent = Partial<Record<"introduced" | "fixed" | "last_affected" | "limit", string>>;

/** The fields of an OSV record Codeman reads (docs/web/osv/open-source-vulnerability-format.md). */
export interface OsvRecord {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  withdrawn?: string;
  severity?: { type?: string; score?: string }[];
  database_specific?: { severity?: unknown };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { type?: string; events?: OsvEvent[] }[];
    versions?: string[];
    database_specific?: { severity?: unknown };
    ecosystem_specific?: { severity?: unknown };
  }[];
}

/** OSV.dev failed to give an answer Codeman can use. */
export class OsvError extends Error {
  /** The HTTP status, when OSV.dev answered one. */
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

/**
 * An outage: OSV.dev could not be reached, timed out, was rate limited, answered a server error
 * or a body that is not JSON. Another try later may succeed.
 */
export class OsvUnavailable extends OsvError {}

/**
 * OSV.dev answered, but not with something usable: a client error, a body of another shape, or
 * more than Codeman's caps allow. Trying again would give the same.
 */
export class OsvUnusable extends OsvError {}

/** Caps on what one call asks of OSV.dev. */
export interface OsvLimits {
  /** Queries per `POST /v1/querybatch`. The API states none; it pages above 1,000 results. */
  batchSize: number;
  /** Pages followed per batch, through `next_page_token` (docs/web/osv/post-v1-querybatch.md#pagination). */
  maxPages: number;
  /** Records one `records` call may fetch. */
  maxRecords: number;
  /** `GET /v1/vulns/{id}` in flight at once. */
  concurrency: number;
  /** Per request. */
  timeoutMs: number;
}

export const OSV_LIMITS: OsvLimits = {
  batchSize: 1000,
  maxPages: 10,
  maxRecords: 1000,
  concurrency: 8,
  timeoutMs: 30_000,
};

/** A source of advisories, such as OSV.dev. */
export interface AdvisoryDatabase {
  /** The IDs of the advisories affecting each query's version, in the queries' order. */
  query(queries: readonly OsvQuery[]): Promise<string[][]>;
  /** The records of `ids`; an ID OSV.dev does not know is left out. */
  records(ids: readonly string[]): Promise<Map<string, OsvRecord>>;
}

/** An advisory ID as OSV.dev writes them (`GHSA-…`, `GO-2025-3557`, `PYSEC-2026-4319`). */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isOsvId(id: string): boolean {
  return ID.test(id);
}

/**
 * OSV.dev's API, without a key (it has no rate limits: docs/web/osv/api.md): `POST
 * /v1/querybatch` for many package versions at once, then `GET /v1/vulns/{id}` for each record,
 * since a batch answers only IDs (docs/web/osv/post-v1-querybatch.md, get-v1-vulns-id.md).
 */
export class Osv implements AdvisoryDatabase {
  readonly #fetch: Fetch;
  readonly #limits: OsvLimits;
  readonly #api: string;

  constructor(fetchFn: Fetch = fetch, limits: Partial<OsvLimits> = {}, api = OSV_API) {
    this.#fetch = fetchFn;
    this.#limits = { ...OSV_LIMITS, ...limits };
    this.#api = api;
  }

  async query(queries: readonly OsvQuery[]): Promise<string[][]> {
    const ids: string[][] = [];
    for (let start = 0; start < queries.length; start += this.#limits.batchSize) {
      ids.push(...(await this.#batch(queries.slice(start, start + this.#limits.batchSize))));
    }
    return ids;
  }

  /** One batch, following the pages of the queries that have more. */
  async #batch(queries: readonly OsvQuery[]): Promise<string[][]> {
    const ids = queries.map((): string[] => []);
    let pending = queries.map((query, index) => ({ index, query, token: undefined as unknown }));
    for (let page = 0; pending.length > 0; page++) {
      if (page === this.#limits.maxPages) {
        throw new OsvUnusable(
          `OSV.dev had more than ${this.#limits.maxPages} pages of advisories for ${pending.length} of the packages queried.`,
        );
      }
      const body = {
        queries: pending.map(({ query, token }) => ({
          package: { ecosystem: query.package.ecosystem, name: query.package.name },
          version: query.version,
          ...(typeof token === "string" ? { page_token: token } : {}),
        })),
      };
      const answer = await this.#request("POST /v1/querybatch", `${this.#api}/v1/querybatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const results = (answer as { results?: unknown } | null)?.results;
      if (!Array.isArray(results) || results.length !== pending.length) {
        throw new OsvUnusable(
          `OSV.dev's querybatch answered ${Array.isArray(results) ? `${results.length} results` : "no results"} for ${pending.length} queries.`,
        );
      }
      const next: typeof pending = [];
      for (const [i, result] of results.entries()) {
        const item = pending[i] as (typeof pending)[number];
        const { vulns, next_page_token: token } = (result ?? {}) as {
          vulns?: unknown;
          next_page_token?: unknown;
        };
        for (const vuln of Array.isArray(vulns) ? vulns : []) {
          const id = (vuln as { id?: unknown } | null)?.id;
          if (typeof id !== "string" || !isOsvId(id)) {
            throw new OsvUnusable(`OSV.dev's querybatch answered an advisory without a valid ID.`);
          }
          const list = ids[item.index] as string[];
          if (!list.includes(id)) list.push(id);
        }
        if (typeof token === "string" && token !== "") next.push({ ...item, token });
      }
      pending = next;
    }
    return ids;
  }

  async records(ids: readonly string[]): Promise<Map<string, OsvRecord>> {
    const unique = [...new Set(ids)];
    if (unique.length > this.#limits.maxRecords) {
      throw new OsvUnusable(
        `${unique.length} advisories to read from OSV.dev, over the cap of ${this.#limits.maxRecords}.`,
      );
    }
    for (const id of unique) {
      if (!isOsvId(id)) throw new OsvUnusable(`\`${id}\` is not an advisory ID OSV.dev serves.`);
    }
    const records = new Map<string, OsvRecord>();
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const id = unique[next++] as string;
        const record = await this.#request(
          `GET /v1/vulns/${id}`,
          `${this.#api}/v1/vulns/${encodeURIComponent(id)}`,
          { method: "GET" },
          true,
        );
        if (record === null) continue;
        if (typeof (record as { id?: unknown }).id !== "string") {
          throw new OsvUnusable(`OSV.dev's record of ${id} has no ID.`);
        }
        records.set(id, record as OsvRecord);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.#limits.concurrency, unique.length) }, worker),
    );
    return records;
  }

  /** The JSON OSV.dev answers, or null for a 404 when `missingIsNull`. */
  async #request(
    what: string,
    url: string,
    init: RequestInit,
    missingIsNull = false,
  ): Promise<object | null> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: { Accept: "application/json", ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(this.#limits.timeoutMs),
      });
    } catch (error) {
      throw new OsvUnavailable(
        `OSV.dev did not answer ${what} (${error instanceof Error ? error.message : error}).`,
        undefined,
        { cause: error },
      );
    }
    if (missingIsNull && response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) {
      throw new OsvUnavailable(
        `OSV.dev answered ${what} with ${response.status}.`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new OsvUnusable(`OSV.dev answered ${what} with ${response.status}.`, response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new OsvUnavailable(
        `OSV.dev answered ${what} with a body that is not JSON.`,
        response.status,
        { cause: error },
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new OsvUnusable(`OSV.dev answered ${what} with JSON that is not an object.`);
    }
    return body;
  }
}
