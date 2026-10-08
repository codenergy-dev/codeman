/**
 * Codeman's operational store: what its jobs share across runs and repositories, such as each
 * run's ledger. Firestore in production, memory in tests; both pass the same contract
 * (`contract.ts`). See docs/backend/backend.md#the-store.
 *
 * Paths name documents and collections by their segments, as in `organizations/o/runs/1`: a
 * document's path has an even number of segments, a collection's an odd one. Build them with
 * `layout.ts`, which keeps each segment a valid ID.
 */
export interface Store extends StoreReader {
  /**
   * Applies the writes all at once, or none of them. Throws `StoreConflict` when a precondition
   * fails: a document to create exists, or one to change is missing or at another version.
   */
  write(writes: readonly Write[]): Promise<void>;
  /**
   * Runs `work` in a transaction, and returns what it returned. Its reads see one state of the
   * store, and its writes apply only if nothing it read changed since; otherwise `work` runs
   * again, up to `attempts` times in all (default 5), then throws `StoreConflict`. An error in
   * `work` leaves the store as it was.
   */
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    options?: { attempts?: number },
  ): Promise<T>;
}

export interface StoreReader {
  /** The document at `path`; undefined when there is none. */
  get(path: string): Promise<StoredDocument | undefined>;
  /** The documents of the collection at `path` that match `query`, without its subcollections. */
  query(path: string, query?: Query): Promise<StoredDocument[]>;
}

/** What a transaction does: it reads, and its writes apply together when it ends. */
export interface Transaction extends StoreReader {
  write(...writes: Write[]): void;
}

/**
 * A value in a document. Whole numbers are stored as integers and others as doubles, but both
 * compare as numbers. Arrays may not hold arrays.
 */
export type Value =
  | null
  | boolean
  | number
  | string
  | Date
  | readonly Value[]
  | { readonly [field: string]: Value };

export type Fields = { readonly [field: string]: Value };

export interface StoredDocument {
  path: string;
  fields: Fields;
  /** Changes with each write that changes the document; a precondition may require it. */
  version: string;
}

/** What a write requires of the document it changes, or it fails with `StoreConflict`. */
export type Precondition = { exists: boolean } | { version: string };

export type Write =
  /** Creates the document; fails when it exists. */
  | { op: "create"; path: string; fields: Fields }
  /**
   * Writes the document, created when missing: all its fields, or with `merge` only those
   * given, which replace the document's own at the top level and leave the others.
   */
  | { op: "set"; path: string; fields: Fields; merge?: boolean; if?: Precondition }
  /** Deletes the document; deleting a missing one does nothing, unless a precondition says. */
  | { op: "delete"; path: string; if?: Precondition };

export interface Query {
  /** Every filter must hold. */
  where?: readonly Filter[];
  orderBy?: readonly { field: string; direction?: "asc" | "desc" }[];
  limit?: number;
}

/** A filter on a top-level field. A document without the field never matches. */
export type Filter = { field: string; op: "==" | "<" | "<=" | ">" | ">="; value: Value };

/** A precondition failed, or a transaction kept conflicting with other writes. */
export class StoreConflict extends Error {}

/** The segments of a path, checked: none empty, `.` or `..`, and an even count for a document. */
export function segments(path: string, kind: "document" | "collection"): string[] {
  const parts = path.split("/");
  const valid =
    parts.every((part) => part !== "" && part !== "." && part !== "..") &&
    parts.length % 2 === (kind === "document" ? 0 : 1);
  if (!valid) throw new Error(`"${path}" is not a ${kind} path.`);
  return parts;
}

/**
 * Checks fields before a write, the same in every store: numbers must be finite, and an array
 * may not hold an array, which Firestore cannot store.
 */
export function checkFields(fields: Fields, path: string): void {
  const check = (value: Value, inArray: boolean): void => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${path}: ${value} is not a finite number.`);
    }
    if (value instanceof Date && Number.isNaN(value.getTime())) {
      throw new Error(`${path}: an invalid date.`);
    }
    if (Array.isArray(value)) {
      if (inArray) throw new Error(`${path}: an array may not hold an array.`);
      for (const item of value) check(item, true);
    } else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      for (const item of Object.values(value)) check(item, false);
    }
  };
  for (const value of Object.values(fields)) check(value, false);
}
