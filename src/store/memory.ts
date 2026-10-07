import {
  checkFields,
  type Fields,
  type Filter,
  type Precondition,
  type Query,
  type Store,
  StoreConflict,
  type StoredDocument,
  segments,
  type Transaction,
  type Value,
  type Write,
} from "./store.ts";

interface Kept {
  fields: Fields;
  version: string;
}

/**
 * A store in memory, for tests. It keeps Firestore's semantics where the contract tests check
 * them: preconditions, one write applied whole or not at all, queries with their typed order,
 * and transactions that run again when a document they read changed before they committed.
 */
export class MemoryStore implements Store {
  readonly #documents = new Map<string, Kept>();
  #clock = 0;

  async get(path: string): Promise<StoredDocument | undefined> {
    segments(path, "document");
    await tick();
    return this.#read(path);
  }

  async query(path: string, query: Query = {}): Promise<StoredDocument[]> {
    segments(path, "collection");
    await tick();
    return this.#query(path, query);
  }

  async write(writes: readonly Write[]): Promise<void> {
    await tick();
    this.#apply(writes);
  }

  async transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    options: { attempts?: number } = {},
  ): Promise<T> {
    const attempts = options.attempts ?? 5;
    for (let attempt = 1; ; attempt++) {
      // What the transaction saw, to tell at its end whether anything changed since.
      const seen = new Map<string, string | undefined>();
      const queries: { path: string; query: Query; paths: string }[] = [];
      const writes: Write[] = [];
      const tx: Transaction = {
        get: async (path) => {
          segments(path, "document");
          await tick();
          const found = this.#read(path);
          seen.set(path, found?.version);
          return found;
        },
        query: async (path, query = {}) => {
          segments(path, "collection");
          await tick();
          const found = this.#query(path, query);
          queries.push({ path, query, paths: signature(found) });
          for (const document of found) seen.set(document.path, document.version);
          return found;
        },
        write: (...more) => {
          writes.push(...more);
        },
      };
      const result = await work(tx);
      await tick();
      const changed =
        [...seen].some(([path, version]) => this.#documents.get(path)?.version !== version) ||
        queries.some((read) => signature(this.#query(read.path, read.query)) !== read.paths);
      if (!changed) {
        this.#apply(writes);
        return result;
      }
      if (attempt >= attempts) {
        throw new StoreConflict(`The transaction conflicted with other writes ${attempt} times.`);
      }
    }
  }

  #read(path: string): StoredDocument | undefined {
    const kept = this.#documents.get(path);
    return kept && { path, fields: structuredClone(kept.fields), version: kept.version };
  }

  #query(path: string, query: Query): StoredDocument[] {
    const depth = segments(path, "collection").length + 1;
    const found = [...this.#documents.keys()]
      .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === depth)
      .flatMap((key) => {
        const document = this.#read(key);
        return document && (query.where ?? []).every((filter) => matches(document, filter))
          ? [document]
          : [];
      });
    // As Firestore: an inequality orders by its field first, and the document's name breaks ties.
    const range = query.where?.find((filter) => filter.op !== "==");
    const order = query.orderBy?.length
      ? query.orderBy
      : range
        ? [{ field: range.field, direction: "asc" as const }]
        : [];
    const ordered = found.filter((document) =>
      order.every((by) => document.fields[by.field] !== undefined),
    );
    const last = order.at(-1)?.direction === "desc" ? -1 : 1;
    ordered.sort((a, b) => {
      for (const by of order) {
        const sign = by.direction === "desc" ? -1 : 1;
        const result = compare(a.fields[by.field] ?? null, b.fields[by.field] ?? null);
        if (result !== 0) return sign * result;
      }
      return last * (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    });
    return query.limit === undefined ? ordered : ordered.slice(0, query.limit);
  }

  /** Applies the writes in order, or none when one's precondition fails. */
  #apply(writes: readonly Write[]): void {
    const next = new Map(this.#documents);
    for (const write of writes) {
      segments(write.path, "document");
      const current = next.get(write.path);
      const required: Precondition | undefined =
        write.op === "create" ? { exists: false } : write.if;
      if (required && !holds(required, current)) {
        throw new StoreConflict(
          `${write.path}: ${"version" in required ? `not at version ${required.version}` : required.exists ? "missing" : "exists"}.`,
        );
      }
      if (write.op === "delete") {
        next.delete(write.path);
        continue;
      }
      checkFields(write.fields, write.path);
      const fields = structuredClone(
        write.op === "set" && write.merge ? { ...current?.fields, ...write.fields } : write.fields,
      );
      // As Firestore: a write that changes nothing keeps the document's version.
      const same = current && sameValue(current.fields, fields);
      next.set(write.path, {
        fields,
        version: same ? current.version : String(++this.#clock).padStart(12, "0"),
      });
    }
    this.#documents.clear();
    for (const [path, kept] of next) this.#documents.set(path, kept);
  }
}

/** Lets other work run between a store's steps, as a network call would. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function holds(precondition: Precondition, current: Kept | undefined): boolean {
  if ("version" in precondition) return current?.version === precondition.version;
  return precondition.exists === (current !== undefined);
}

function signature(documents: readonly StoredDocument[]): string {
  return documents.map((document) => `${document.path}@${document.version}`).join(",");
}

function matches(document: StoredDocument, filter: Filter): boolean {
  const value = document.fields[filter.field];
  if (value === undefined) return false;
  if (filter.op === "==") return sameValue(value, filter.value);
  // A range only matches values of the filter's own type, as in Firestore.
  if (rank(value) !== rank(filter.value)) return false;
  const result = compare(value, filter.value);
  if (filter.op === "<") return result < 0;
  if (filter.op === "<=") return result <= 0;
  if (filter.op === ">") return result > 0;
  return result >= 0;
}

/** Firestore's order of types: null, booleans, numbers, dates, strings, arrays, maps. */
function rank(value: Value): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (value instanceof Date) return 3;
  if (typeof value === "string") return 4;
  if (Array.isArray(value)) return 5;
  return 6;
}

function compare(a: Value, b: Value): number {
  const byType = rank(a) - rank(b);
  if (byType !== 0) return byType;
  if (typeof a === "boolean" || typeof a === "number") return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const result = compare(a[index] ?? null, b[index] ?? null);
      if (result !== 0) return result;
    }
    return a.length - b.length;
  }
  const left = Object.entries(a ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  const right = Object.entries(b ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const [keyA = "", valueA = null] = left[index] ?? [];
    const [keyB = "", valueB = null] = right[index] ?? [];
    if (keyA !== keyB) return keyA < keyB ? -1 : 1;
    const result = compare(valueA, valueB);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function sameValue(a: Value | Fields, b: Value | Fields): boolean {
  return compare(a as Value, b as Value) === 0;
}
