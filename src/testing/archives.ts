import { crc32, deflateRawSync } from "node:zlib";

/** An entry of a test archive. Only what the tests need: the archive reader must refuse the rest. */
export interface TestEntry {
  name: string;
  data?: string | Buffer;
  /** `file` by default. */
  type?: "file" | "dir" | "symlink" | "hardlink" | "fifo";
  /** ZIP only: stored instead of deflated. */
  stored?: boolean;
  /** ZIP only: the flag of an encrypted entry. */
  encrypted?: boolean;
  /** ZIP only: a CRC-32 that does not match the data. */
  badCrc?: boolean;
  /** ZIP only: the size the central directory declares, instead of the real one. */
  declaredSize?: number;
}

const UNIX_TYPES = {
  file: 0o100644,
  dir: 0o040755,
  symlink: 0o120777,
  hardlink: 0o100644,
  fifo: 0o010644,
};

/** A ZIP archive, written as `zip` would on Unix. */
export function zip(entries: readonly TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const type = entry.type ?? "file";
    const name = Buffer.from(
      type === "dir" && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name,
    );
    const data = Buffer.from(entry.data ?? "");
    const method = entry.stored || type !== "file" ? 0 : 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const crc = entry.badCrc ? (crc32(data) ^ 1) >>> 0 : crc32(data);
    const size = entry.declaredSize ?? data.length;
    const flags = 0x800 | (entry.encrypted ? 1 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((UNIX_TYPES[type] << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const TAR_TYPES = { file: "0", dir: "5", symlink: "2", hardlink: "1", fifo: "6" };

/** A ustar archive, with a GNU long name for names over 100 bytes. */
export function tar(entries: readonly TestEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const type = entry.type ?? "file";
    const data = Buffer.from(entry.data ?? "");
    const name = Buffer.from(entry.name);
    if (name.length > 100) {
      blocks.push(
        tarHeader("././@LongLink", "L", name.length + 1),
        padded(Buffer.concat([name, Buffer.alloc(1)])),
      );
    }
    blocks.push(
      tarHeader(entry.name.slice(0, 100), TAR_TYPES[type], type === "file" ? data.length : 0),
    );
    if (type === "file") blocks.push(padded(data));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** A pax header that names the next entry. */
export function paxPath(path: string): Buffer {
  const record = (length: number) => `${length} path=${path}\n`;
  let length = record(0).length;
  while (record(length).length !== length) length = record(length).length;
  const data = Buffer.from(record(length));
  return Buffer.concat([tarHeader("pax", "x", data.length), padded(data)]);
}

function tarHeader(name: string, type: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

function padded(data: Buffer): Buffer {
  return Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
