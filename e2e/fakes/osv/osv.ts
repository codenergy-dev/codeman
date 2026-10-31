import { readFileSync } from "node:fs";
import type { OsvRecord } from "../../../src/inference/osv.ts";
import { compareVersions } from "../../../src/inference/release-policy.ts";
import { FakeServer, HttpError, json } from "../http.ts";

/**
 * OSV.dev's API for `open-key`'s release policy (src/inference/osv.ts), which the e2e build reaches
 * through its `osv` endpoint: `POST /v1/querybatch` and `GET /v1/vulns/{id}`
 * (docs/web/osv/post-v1-querybatch.md, get-v1-vulns-id.md), answered from records it holds.
 *
 * By default it holds the records OSV.dev answered for the catalog's releases on 2026-10-30:
 * `src/inference/osv-fixtures.json`, the unit tests' copies, and `records.json` beside this file,
 * the other Ollama records that `docs/web/osv/ollama-*.md` describe. So Ollama 0.40.10 gets its 9
 * advisories, each of which the catalog's exceptions accept, and vLLM 0.32.0 and Node.js none. A
 * scenario adds records (`world.osv`) through the control API; a reset drops them.
 */

const DEFAULT_RECORDS: readonly OsvRecord[] = [
  ...Object.values(
    JSON.parse(
      readFileSync(new URL("../../../src/inference/osv-fixtures.json", import.meta.url), "utf8"),
    ) as Record<string, OsvRecord>,
  ),
  ...Object.values(
    JSON.parse(readFileSync(new URL("./records.json", import.meta.url), "utf8")) as Record<
      string,
      OsvRecord
    >,
  ),
];

/** What a query names, as `POST /v1/querybatch` takes it. */
interface Query {
  package: { ecosystem: string; name: string };
  version: string;
}

export class OsvFake {
  readonly server: FakeServer;
  readonly #records = new Map<string, OsvRecord>();

  constructor(records: readonly OsvRecord[] = DEFAULT_RECORDS) {
    const defaults = () => {
      this.#records.clear();
      for (const record of records) this.#records.set(record.id, record);
    };
    defaults();
    this.server = new FakeServer("osv");
    this.server.onReset(defaults);

    this.server.route("POST", "/v1/querybatch", (request) => {
      const queries = (request.json() as { queries?: unknown } | null)?.queries;
      if (!Array.isArray(queries)) {
        throw new HttpError(400, { code: 3, message: "Invalid query." });
      }
      return json({
        results: queries.map((query) => {
          const vulns = this.affecting(queryOf(query)).map((record) => ({
            id: record.id,
            modified: (record as { modified?: string }).modified ?? "2026-10-30T00:00:00Z",
          }));
          // OSV.dev leaves `vulns` out of a result without any.
          return vulns.length > 0 ? { vulns } : {};
        }),
      });
    });
    this.server.route("GET", "/v1/vulns/{id}", (request) => {
      const record = this.#records.get(request.params.id ?? "");
      return record ? json(record) : json({ code: 5, message: "Bug not found." }, 404);
    });

    this.server.control("PUT", "/osv/records", (request) => {
      const body = request.json() as { records?: unknown } | null;
      if (!Array.isArray(body?.records)) {
        throw new HttpError(400, { message: "PUT records takes { records: [OSV records] }." });
      }
      for (const record of body.records as OsvRecord[]) {
        if (typeof record?.id !== "string" || record.id === "") {
          throw new HttpError(400, { message: "Each record has an `id`." });
        }
        this.#records.set(record.id, record);
      }
      return { status: 204 };
    });
    this.server.control("GET", "/osv/records", () => json([...this.#records.values()]));
  }

  /** The records that affect the query's version, not withdrawn, oldest ID first. */
  affecting(query: Query): OsvRecord[] {
    return [...this.#records.values()]
      .filter((record) => !record.withdrawn && affects(record, query))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

function queryOf(value: unknown): Query {
  const query = value as Partial<Query> | null;
  const pkg = query?.package;
  if (
    typeof pkg?.ecosystem !== "string" ||
    typeof pkg.name !== "string" ||
    typeof query?.version !== "string"
  ) {
    throw new HttpError(400, {
      code: 3,
      message: "The fake answers only queries of a package's ecosystem, name and version.",
    });
  }
  return { package: { ecosystem: pkg.ecosystem, name: pkg.name }, version: query.version };
}

/**
 * Whether `record` affects the query's version: one of its `affected` entries names the package
 * and lists the version, or one of its ranges holds it, from an `introduced` event up to the next
 * `fixed` (excluded) or `last_affected` (included) (docs/web/osv/open-source-vulnerability-format.md).
 */
export function affects(record: OsvRecord, query: Query): boolean {
  return (record.affected ?? []).some((affected) => {
    if (
      affected.package?.ecosystem !== query.package.ecosystem ||
      affected.package?.name !== query.package.name
    ) {
      return false;
    }
    if (affected.versions?.some((version) => compare(version, query.version) === 0)) return true;
    return (affected.ranges ?? []).some((range) => {
      if (range.type === "GIT") return false;
      const events = (range.events ?? [])
        .flatMap((event) =>
          (["introduced", "fixed", "last_affected"] as const).flatMap((kind) =>
            typeof event[kind] === "string" ? [{ kind, at: event[kind] as string }] : [],
          ),
        )
        .sort((x, y) => compare(x.at, y.at));
      let inside = false;
      for (const { kind, at } of events) {
        const order = compare(at, query.version);
        if (kind === "introduced" && order <= 0) inside = true;
        else if (kind === "fixed" && order <= 0) inside = false;
        else if (kind === "last_affected" && order < 0) inside = false;
      }
      return inside;
    });
  });
}

/** Versions in order, where "0" comes before every other. */
function compare(a: string, b: string): number {
  if (a === "0" || b === "0") return a === b ? 0 : a === "0" ? -1 : 1;
  return compareVersions(a, b);
}

/** The fake for e2e/fakes/main.ts, with its default records. */
export function fromEnv(): FakeServer {
  return new OsvFake().server;
}
