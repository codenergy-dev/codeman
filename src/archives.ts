import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { crc32, gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Extraction of the archives maintainers attach to a task, in-house: no program runs, nothing is
 * written but regular files and directories inside the target, and the sizes are bounded before
 * and while inflating. See docs/tasks/attachments.md#archives.
 */

export type ArchiveKind = "zip" | "tar" | "tar.gz" | "gz";

/** What is left to extract in the run: bytes and files. Extraction takes from it. */
export interface ExtractBudget {
  bytes: number;
  files: number;
}

/** Why an entry was not written. */
export type SkipReason =
  /** A symbolic or hard link. */
  | "link"
  /** A device, a named pipe or another special file. */
  | "special"
  /** An absolute path, a `..` part, a drive letter or a control character. */
  | "unsafe-path"
  /** A file or directory already has its path. */
  | "exists"
  | "encrypted"
  /** A compression method or entry type the extractor does not read. */
  | "unsupported"
  /** Its data does not match its size or checksum. */
  | "corrupt";

export interface Extracted {
  files: number;
  bytes: number;
  skipped: { path: string; reason: SkipReason }[];
  /** The archive would exceed the run's budget: nothing of it was written. */
  stopped?: "too-large" | "too-many-files";
}

export type ExtractResult = { ok: true; value: Extracted } | { ok: false; error: string };

/** The kind of archive a file name says it is, if any. */
export function archiveKind(name: string): ArchiveKind | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".zip") && lower.length > 4) return "zip";
  if (lower.endsWith(".tar") && lower.length > 4) return "tar";
  if (lower.endsWith(".gz") && lower.length > 3) return "gz";
  return undefined;
}

/** An entry, read and classified before anything is written. */
interface Entry {
  path: string;
  type: "file" | "dir";
  size: number;
  /** The file's data, checked against its size and checksum. */
  data: () => Buffer | undefined;
}

/**
 * Extracts the archive `name` into `target`, which it creates. An archive that would exceed
 * `budget` writes nothing; otherwise extraction takes its files and bytes from it.
 */
export function extractArchive(
  name: string,
  archive: Buffer,
  target: string,
  budget: ExtractBudget,
): ExtractResult {
  const kind = archiveKind(name);
  if (!kind) return { ok: false, error: "not an archive Codeman extracts" };
  const skipped: Extracted["skipped"] = [];
  let entries: Entry[];
  if (kind === "zip") {
    const read = readZip(archive, skipped);
    if (!read.ok) return read;
    entries = read.value;
  } else {
    let data = archive;
    if (kind !== "tar") {
      // The output of a gzip stream is bounded while it inflates: a tar's headers and padding
      // take at most 1.5 KB per file, and two blocks end it.
      const max = kind === "gz" ? budget.bytes : budget.bytes + (budget.files + 1) * 1536 + 1024;
      const inflated = gunzip(archive, max);
      if (inflated === "too-large") return stopped("too-large");
      if (inflated === undefined) return { ok: false, error: "not a gzip file" };
      data = inflated;
    }
    if (kind === "gz") {
      const inner = name.replace(/\.gz$/i, "").replace(/^.*[\\/]/, "") || "content";
      entries = [{ path: inner, type: "file", size: data.length, data: () => data }];
    } else {
      const read = readTar(data, skipped);
      if (!read.ok) return read;
      entries = read.value;
    }
  }

  const files = entries.filter((entry) => entry.type === "file");
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  if (total > budget.bytes) return stopped("too-large");
  if (files.length > budget.files) return stopped("too-many-files");

  mkdirSync(target, { recursive: true });
  const root = resolve(target);
  const extracted: Extracted = { files: 0, bytes: 0, skipped };
  for (const entry of entries) {
    const parts = safeParts(entry.path);
    const path = parts ? resolve(root, ...parts) : "";
    if (!path.startsWith(`${root}${sep}`)) {
      skipped.push({ path: entry.path, reason: "unsafe-path" });
      continue;
    }
    if (entry.type === "dir") {
      if (!makeDirectory(path)) skipped.push({ path: entry.path, reason: "exists" });
      continue;
    }
    const data = entry.data();
    if (!data) {
      skipped.push({ path: entry.path, reason: "corrupt" });
      continue;
    }
    if (!makeDirectory(dirname(path)) || !writeNew(path, data)) {
      skipped.push({ path: entry.path, reason: "exists" });
      continue;
    }
    extracted.files += 1;
    extracted.bytes += data.length;
    budget.files -= 1;
    budget.bytes -= data.length;
  }
  return { ok: true, value: extracted };
}

function stopped(why: NonNullable<Extracted["stopped"]>): ExtractResult {
  return { ok: true, value: { files: 0, bytes: 0, skipped: [], stopped: why } };
}

function gunzip(data: Buffer, max: number): Buffer | "too-large" | undefined {
  try {
    return gunzipSync(data, { maxOutputLength: Math.max(max, 1) });
  } catch (error) {
    return error instanceof RangeError ? "too-large" : undefined;
  }
}

/** The parts of a relative path that stays where it is extracted, or undefined. */
function safeParts(path: string): string[] | undefined {
  const normalized = path.replace(/\\/g, "/");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused.
  if (/[\u0000-\u001f\u007f]/.test(normalized) || normalized.length > 4096) return undefined;
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return undefined;
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return undefined;
  if (parts.some((part) => part === ".." || Buffer.byteLength(part) > 255)) return undefined;
  return parts;
}

/** Creates a directory and its parents, unless a file is in the way. No links are ever made. */
function makeDirectory(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true, mode: 0o755 });
    return true;
  } catch {
    return false;
  }
}

/** Writes a new file; false if something has its path. */
function writeNew(path: string, data: Buffer): boolean {
  try {
    writeFileSync(path, data, { flag: "wx", mode: 0o644 });
    return true;
  } catch {
    return false;
  }
}

type Read = { ok: true; value: Entry[] } | { ok: false; error: string };

const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

/** A ZIP archive's entries, from its central directory. */
function readZip(archive: Buffer, skipped: Extracted["skipped"]): Read {
  let end = -1;
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 65_557); at--) {
    if (archive.readUInt32LE(at) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end < 0) return { ok: false, error: "not a ZIP archive" };
  const count = archive.readUInt16LE(end + 10);
  const size = archive.readUInt32LE(end + 12);
  const offset = archive.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    return { ok: false, error: "a ZIP64 archive, which Codeman does not extract" };
  }
  const entries: Entry[] = [];
  let at = offset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== ZIP_CENTRAL) {
      return { ok: false, error: "the ZIP archive's directory is damaged" };
    }
    const madeBy = archive.readUInt16LE(at + 4);
    const flags = archive.readUInt16LE(at + 8);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const compressed = archive.readUInt32LE(at + 20);
    const uncompressed = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const attributes = archive.readUInt32LE(at + 38);
    const local = archive.readUInt32LE(at + 42);
    const name = archive
      .subarray(at + 46, at + 46 + nameLength)
      .toString(flags & 0x800 ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;

    // Unix-made entries carry their file type in the high bits of the external attributes.
    const mode = madeBy >> 8 === 3 ? (attributes >>> 16) & 0o170000 : 0;
    const directory = name.endsWith("/") || name.endsWith("\\") || mode === 0o040000;
    if (mode === 0o120000) skipped.push({ path: name, reason: "link" });
    else if (mode !== 0 && mode !== 0o100000 && mode !== 0o040000) {
      skipped.push({ path: name, reason: "special" });
    } else if (!safeParts(name)) skipped.push({ path: name, reason: "unsafe-path" });
    else if (directory) entries.push({ path: name, type: "dir", size: 0, data: () => undefined });
    else if (flags & 1) skipped.push({ path: name, reason: "encrypted" });
    else if (method !== 0 && method !== 8) skipped.push({ path: name, reason: "unsupported" });
    else {
      entries.push({
        path: name,
        type: "file",
        size: uncompressed,
        data: () => zipData(archive, local, method, compressed, uncompressed, crc),
      });
    }
  }
  return { ok: true, value: entries };
}

/** An entry's data, only when it has the size and CRC-32 the directory declares. */
function zipData(
  archive: Buffer,
  local: number,
  method: number,
  compressed: number,
  uncompressed: number,
  crc: number,
): Buffer | undefined {
  if (local + 30 > archive.length || archive.readUInt32LE(local) !== ZIP_LOCAL) return undefined;
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  if (start + compressed > archive.length) return undefined;
  const body = archive.subarray(start, start + compressed);
  let data: Buffer;
  try {
    // Never more than the declared size: an entry that claims less than it holds stops there.
    data =
      method === 0 ? body : inflateRawSync(body, { maxOutputLength: Math.max(uncompressed, 1) });
  } catch {
    return undefined;
  }
  return data.length === uncompressed && crc32(data) === crc ? data : undefined;
}

/** A tar archive's entries, with GNU long names and pax paths. */
function readTar(archive: Buffer, skipped: Extracted["skipped"]): Read {
  const entries: Entry[] = [];
  let longName: string | undefined;
  let at = 0;
  while (at + 512 <= archive.length) {
    const header = archive.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumMatches(header)) {
      return { ok: false, error: "a tar header's checksum does not match" };
    }
    const sizeField = header.subarray(124, 136);
    if ((sizeField[0] ?? 0) & 0x80) return { ok: false, error: "a tar entry is too large" };
    const size = Number.parseInt(text(sizeField).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      return { ok: false, error: "a tar entry has no valid size" };
    }
    const start = at + 512;
    if (start + size > archive.length) {
      return { ok: false, error: "the tar archive ends inside an entry" };
    }
    const body = archive.subarray(start, start + size);
    at = start + Math.ceil(size / 512) * 512;

    const type = String.fromCharCode(header[156] ?? 0);
    if (type === "L") {
      longName = text(body);
      continue;
    }
    if (type === "x") {
      longName = paxPathOf(body) ?? longName;
      continue;
    }
    if (type === "g" || type === "K") continue;
    const prefix = text(header.subarray(345, 500));
    const own = text(header.subarray(0, 100));
    const ustar = text(header.subarray(257, 262)) === "ustar";
    const path = longName ?? (ustar && prefix ? `${prefix}/${own}` : own);
    longName = undefined;

    if (type === "1" || type === "2") skipped.push({ path, reason: "link" });
    else if (type === "3" || type === "4" || type === "6")
      skipped.push({ path, reason: "special" });
    else if (type !== "0" && type !== "\0" && type !== "7" && type !== "5") {
      skipped.push({ path, reason: "unsupported" });
    } else if (!safeParts(path)) skipped.push({ path, reason: "unsafe-path" });
    else if (type === "5") entries.push({ path, type: "dir", size: 0, data: () => undefined });
    else entries.push({ path, type: "file", size, data: () => body });
  }
  return { ok: true, value: entries };
}

function text(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

function checksumMatches(header: Buffer): boolean {
  let sum = 0;
  for (let index = 0; index < 512; index++) {
    sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  }
  return Number.parseInt(text(header.subarray(148, 156)).trim(), 8) === sum;
}

/** The `path` record of a pax header, if it has one. */
function paxPathOf(body: Buffer): string | undefined {
  let path: string | undefined;
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number.parseInt(body.subarray(at, space).toString("utf8"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || at + length > body.length) break;
    const record = body.subarray(space + 1, at + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (record.slice(0, equals) === "path") path = record.slice(equals + 1);
    at += length;
  }
  return path;
}

/** Where an archive's content goes: a directory beside it, named after it. */
export function extractedDirectory(file: string): string {
  return `${file}.extracted`;
}
