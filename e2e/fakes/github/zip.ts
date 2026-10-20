import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Zip archives, as GitHub stores artifacts: written with stored or deflated entries, read from the
 * central directory, so entries with data descriptors (as `upload-artifact` writes them) read too.
 * No Zip64, encryption or multi-disk archives.
 */

export interface ZipEntry {
  /** A relative path with `/` separators; a trailing `/` marks a directory. */
  path: string;
  data: Buffer;
  /** The Unix mode, such as 0o100644. */
  mode?: number;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const STORE = 0;
const DEFLATE = 8;
/** UTF-8 names. */
const UTF8_FLAG = 0x0800;
/** 1980-01-01 00:00, the earliest DOS time: archives of the same files are the same bytes. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/** An archive of `entries`, each deflated when that makes it smaller. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const deflated = deflateRawSync(entry.data);
    const method = deflated.length < entry.data.length ? DEFLATE : STORE;
    const body = method === DEFLATE ? deflated : entry.data;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = entry.mode ?? (entry.path.endsWith("/") ? 0o40755 : 0o100644);
    central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The files of an archive, directories left out; throws on what it cannot read or trust. */
export function readZip(archive: Buffer): ZipEntry[] {
  const end = findEnd(archive);
  const count = archive.readUInt16LE(end + 10);
  const size = archive.readUInt32LE(end + 12);
  let at = archive.readUInt32LE(end + 16);
  if (at + size > end) throw new Error("The zip's central directory is out of bounds.");
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(at) !== CENTRAL) throw new Error("A zip entry is corrupt.");
    const flags = archive.readUInt16LE(at + 8);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const compressed = archive.readUInt32LE(at + 20);
    const length = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const mode = archive.readUInt32LE(at + 38) >>> 16;
    const local = archive.readUInt32LE(at + 42);
    const path = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error(`The zip entry ${path} is encrypted.`);
    if (compressed === 0xffffffff || length === 0xffffffff || local === 0xffffffff) {
      throw new Error(`The zip entry ${path} needs Zip64.`);
    }
    if (!safePath(path)) throw new Error(`The zip entry ${path} leaves the archive's root.`);
    if (path.endsWith("/")) continue;
    if (archive.readUInt32LE(local) !== LOCAL) throw new Error(`The zip entry ${path} is corrupt.`);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const body = archive.subarray(start, start + compressed);
    if (body.length !== compressed) throw new Error(`The zip entry ${path} is truncated.`);
    let data: Buffer;
    if (method === STORE) data = Buffer.from(body);
    else if (method === DEFLATE) data = inflateRawSync(body);
    else throw new Error(`The zip entry ${path} uses method ${method}.`);
    if (data.length !== length || crc32(data) !== crc) {
      throw new Error(`The zip entry ${path} fails its CRC check.`);
    }
    entries.push({ path, data, ...(mode ? { mode } : {}) });
  }
  return entries;
}

function findEnd(archive: Buffer): number {
  const last = Math.max(0, archive.length - 22 - 0xffff);
  for (let at = archive.length - 22; at >= last; at--) {
    if (archive.readUInt32LE(at) === END) return at;
  }
  throw new Error("Not a zip archive.");
}

function safePath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    path.split("/").every((part) => part !== "..")
  );
}
