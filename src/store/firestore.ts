import { setTimeout as sleep } from "node:timers/promises";
import type { Fetch } from "../budget.ts";
import {
  checkFields,
  type Fields,
  type Filter,
  type Query,
  type Store,
  StoreConflict,
  type StoredDocument,
  segments,
  type Transaction,
  type Value,
  type Write,
} from "./store.ts";

/** Firestore's API. See docs/web/google-cloud/rest-resource-projects-databases-documents.md. */
const API = "https://firestore.googleapis.com";

/** How long one request may take; the emulator, for one, never answers some. */
const TIMEOUT_MS = 30_000;

/** Firestore's value in its REST form. See docs/web/google-cloud/value.md. */
interface RestValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number | string;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: RestValue[] };
  mapValue?: { fields?: Record<string, RestValue> };
}

interface RestDocument {
  name: string;
  fields?: Record<string, RestValue>;
  updateTime: string;
}

export interface FirestoreOptions {
  /** The Google Cloud project, the Firebase project's ID. */
  project: string;
  /** The API's origin: Firestore's, or an emulator's, such as `http://127.0.0.1:8080`. */
  baseUrl?: string;
  /** An access token for each request. None for the emulator, which takes requests without. */
  token?: () => Promise<string>;
  fetch?: Fetch;
  /** For tests: the wait between a transaction's attempts. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * The store on Cloud Firestore, through its REST API v1: the project's `(default)` database, in
 * Native mode. Reads use `batchGet` and `runQuery`; writes, `commit`; transactions add
 * `beginTransaction` and `rollback`. See docs/web/google-cloud/.
 */
export class Firestore implements Store {
  readonly #database: string;
  readonly #baseUrl: string;
  readonly #token: (() => Promise<string>) | undefined;
  readonly #fetch: Fetch;
  readonly #wait: (ms: number) => Promise<void>;

  constructor(options: FirestoreOptions) {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.project)) {
      throw new Error(`"${options.project}" is not a Google Cloud project ID.`);
    }
    this.#database = `projects/${options.project}/databases/(default)`;
    this.#baseUrl = options.baseUrl ?? API;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#wait = options.wait ?? ((ms) => sleep(ms));
  }

  /** Firestore's emulator at `host` (`host:port`), as `FIRESTORE_EMULATOR_HOST` names it. */
  static emulator(host: string, project: string, fetchFn?: Fetch): Firestore {
    return new Firestore({ project, baseUrl: `http://${host}`, fetch: fetchFn });
  }

  get(path: string): Promise<StoredDocument | undefined> {
    return this.#get(path);
  }

  query(path: string, query?: Query): Promise<StoredDocument[]> {
    return this.#query(path, query);
  }

  async write(writes: readonly Write[]): Promise<void> {
    await this.#call("commit", { writes: writes.map((write) => this.#write(write)) });
  }

  async transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    options: { attempts?: number } = {},
  ): Promise<T> {
    const attempts = options.attempts ?? 5;
    let previous: string | undefined;
    for (let attempt = 1; ; attempt++) {
      // A retried transaction names the one before it, which gives it priority for its locks.
      const { transaction } = (await this.#call("beginTransaction", {
        options: { readWrite: previous ? { retryTransaction: previous } : {} },
      })) as { transaction: string };
      const writes: Write[] = [];
      const tx: Transaction = {
        get: (path) => this.#get(path, transaction),
        query: (path, query) => this.#query(path, query, transaction),
        write: (...more) => {
          writes.push(...more);
        },
      };
      let result: T;
      try {
        result = await work(tx);
      } catch (error) {
        // A transaction holds its reads' locks until it ends.
        await this.#call("rollback", { transaction }).catch(() => undefined);
        throw error;
      }
      try {
        await this.#call("commit", {
          writes: writes.map((write) => this.#write(write)),
          transaction,
        });
        return result;
      } catch (error) {
        if (!(error instanceof Aborted)) throw error;
        if (attempt >= attempts) {
          throw new StoreConflict(
            `The transaction conflicted with other writes ${attempt} times: ${error.message}`,
          );
        }
      }
      previous = transaction;
      // Transactions that abort each other at once must not retry at once again.
      await this.#wait(Math.round((0.5 + Math.random()) * 200 * attempt));
    }
  }

  async #get(path: string, transaction?: string): Promise<StoredDocument | undefined> {
    const name = this.#name(path, "document");
    const results = (await this.#call("batchGet", {
      documents: [name],
      ...(transaction ? { transaction } : {}),
    })) as { found?: RestDocument; missing?: string }[];
    const found = results.find((result) => result.found)?.found;
    return found && this.#document(found);
  }

  async #query(path: string, query: Query = {}, transaction?: string): Promise<StoredDocument[]> {
    const parts = segments(path, "collection");
    const collectionId = parts.pop() ?? "";
    const filters = (query.where ?? []).map(fieldFilter);
    const structuredQuery = {
      from: [{ collectionId }],
      ...(filters.length === 1
        ? { where: filters[0] }
        : filters.length > 1
          ? { where: { compositeFilter: { op: "AND", filters } } }
          : {}),
      ...(query.orderBy?.length
        ? {
            orderBy: query.orderBy.map((by) => ({
              field: { fieldPath: fieldPath(by.field) },
              direction: by.direction === "desc" ? "DESCENDING" : "ASCENDING",
            })),
          }
        : {}),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    };
    const parent = parts.map(encodeURIComponent).join("/");
    const results = (await this.#call(
      "runQuery",
      { structuredQuery, ...(transaction ? { transaction } : {}) },
      parent,
    )) as { document?: RestDocument }[];
    return results.flatMap((result) => (result.document ? [this.#document(result.document)] : []));
  }

  #write(write: Write): unknown {
    const name = this.#name(write.path, "document");
    const precondition =
      write.op === "create"
        ? { exists: false }
        : write.if && ("version" in write.if ? { updateTime: write.if.version } : write.if);
    const current = precondition ? { currentDocument: precondition } : {};
    if (write.op === "delete") return { delete: name, ...current };
    checkFields(write.fields, write.path);
    return {
      update: { name, fields: encodeFields(write.fields) },
      // Without a mask, the document is replaced whole.
      ...(write.op === "set" && write.merge
        ? { updateMask: { fieldPaths: Object.keys(write.fields).map(fieldPath) } }
        : {}),
      ...current,
    };
  }

  #name(path: string, kind: "document" | "collection"): string {
    segments(path, kind);
    return `${this.#database}/documents/${path}`;
  }

  #document(document: RestDocument): StoredDocument {
    const prefix = `${this.#database}/documents/`;
    if (!document.name.startsWith(prefix)) {
      throw new Error(`Firestore returned a document of another database: ${document.name}.`);
    }
    return {
      path: document.name.slice(prefix.length),
      fields: decodeFields(document.fields ?? {}),
      version: document.updateTime,
    };
  }

  /** `POST .../documents[/parent]:method`, with the token, if any. */
  async #call(method: string, body: unknown, parent = ""): Promise<unknown> {
    const url = `${this.#baseUrl}/v1/${this.#database}/documents${parent ? `/${parent}` : ""}:${method}`;
    const token = this.#token ? await this.#token() : undefined;
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return response.json();
    const error = await problem(response);
    const text = `Firestore ${method} failed with ${response.status}${error.status ? ` ${error.status}` : ""}${error.message ? `: ${error.message}` : "."}`;
    if (error.status === "ABORTED") throw new Aborted(text);
    // A precondition that does not hold: the document exists, is missing, or changed.
    if (
      method === "commit" &&
      ["ALREADY_EXISTS", "FAILED_PRECONDITION", "NOT_FOUND"].includes(error.status ?? "")
    ) {
      throw new StoreConflict(text);
    }
    throw new Error(text);
  }
}

/** Firestore ended a transaction for contention: it may run again. */
class Aborted extends Error {}

/** The status and message of Firestore's error, on one line. They hold no credential. */
async function problem(response: Response): Promise<{ status?: string; message?: string }> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { status?: unknown; message?: unknown } }
    | undefined;
  const status = typeof body?.error?.status === "string" ? body.error.status : undefined;
  const message =
    typeof body?.error?.message === "string"
      ? body.error.message.replace(/\s+/g, " ").trim().slice(0, 500)
      : undefined;
  return { status, message };
}

/** A field's path: a plain name as is, any other between backticks. */
function fieldPath(field: string): string {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(field)
    ? field
    : `\`${field.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;
}

const OPERATORS: Record<Filter["op"], string> = {
  "==": "EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
};

function fieldFilter(filter: Filter): unknown {
  return {
    fieldFilter: {
      field: { fieldPath: fieldPath(filter.field) },
      op: OPERATORS[filter.op],
      value: encode(filter.value),
    },
  };
}

export function encodeFields(fields: Fields): Record<string, RestValue> {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, encode(value)]));
}

function encode(value: Value): RestValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: encodeFields(value as Fields) } };
}

export function decodeFields(fields: Record<string, RestValue>): Fields {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, decode(value)]));
}

function decode(value: RestValue): Value {
  if ("booleanValue" in value) return value.booleanValue === true;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.timestampValue !== undefined) return new Date(value.timestampValue);
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value.mapValue) return decodeFields(value.mapValue.fields ?? {});
  // Null, and the types Codeman never writes (bytes, references, points), read as null.
  return null;
}
