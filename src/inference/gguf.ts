/**
 * The metadata at the head of a GGUF file: its key-value pairs, as far as the bytes given hold
 * them, read as Ollama 0.40.10 reads them (`fs/gguf/gguf.go`,
 * docs/web/ollama/fs-gguf-gguf-go-at-v0-40-10.md). Numbers, booleans and strings are kept; an
 * array of numbers is kept up to `MAX_ARRAY` items, as Ollama keeps per-layer arrays, and any
 * other array, such as a tokenizer's vocabulary, is skipped. Undefined when the bytes are not a
 * GGUF file.
 */

/** Per-layer arrays scale with the block count; tokenizer vocabularies are far larger. */
export const MAX_ARRAY = 4096;

const UINT8 = 0;
const INT8 = 1;
const UINT16 = 2;
const INT16 = 3;
const UINT32 = 4;
const INT32 = 5;
const FLOAT32 = 6;
const BOOL = 7;
const STRING = 8;
const ARRAY = 9;
const UINT64 = 10;
const INT64 = 11;
const FLOAT64 = 12;

/** Bytes of each scalar type. */
const SIZES: Readonly<Record<number, number>> = {
  [UINT8]: 1,
  [INT8]: 1,
  [UINT16]: 2,
  [INT16]: 2,
  [UINT32]: 4,
  [INT32]: 4,
  [FLOAT32]: 4,
  [BOOL]: 1,
  [UINT64]: 8,
  [INT64]: 8,
  [FLOAT64]: 8,
};

/** The bytes ran out before what they had to hold. */
class Truncated extends Error {}

export interface GgufMetadata {
  /** The pairs read, by key; a skipped array's key is absent. */
  kv: Record<string, unknown>;
  /** Whether every pair the header announces was read. */
  complete: boolean;
}

export function ggufMetadata(bytes: Uint8Array): GgufMetadata | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== "GGUF" && magic !== "FUGG") return undefined;
  const little = magic === "GGUF";
  let offset = 4;

  const need = (count: number) => {
    if (offset + count > bytes.byteLength) throw new Truncated();
  };
  const u32 = () => {
    need(4);
    const value = view.getUint32(offset, little);
    offset += 4;
    return value;
  };
  const u64 = () => {
    need(8);
    const value = view.getBigUint64(offset, little);
    offset += 8;
    return value;
  };
  const length = () => {
    const value = u64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Truncated();
    return Number(value);
  };
  const text = () => {
    const size = length();
    need(size);
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + size));
    offset += size;
    return value;
  };
  const scalar = (type: number): number | boolean => {
    const size = SIZES[type];
    if (size === undefined) throw new Error(`Unknown GGUF type ${type}.`);
    need(size);
    const at = offset;
    offset += size;
    switch (type) {
      case UINT8:
        return view.getUint8(at);
      case INT8:
        return view.getInt8(at);
      case UINT16:
        return view.getUint16(at, little);
      case INT16:
        return view.getInt16(at, little);
      case UINT32:
        return view.getUint32(at, little);
      case INT32:
        return view.getInt32(at, little);
      case FLOAT32:
        return view.getFloat32(at, little);
      case BOOL:
        return view.getUint8(at) !== 0;
      case UINT64:
        return Number(view.getBigUint64(at, little));
      case INT64:
        return Number(view.getBigInt64(at, little));
      default:
        return view.getFloat64(at, little);
    }
  };
  /** A value, or undefined for an array that is skipped. */
  const value = (type: number): unknown => {
    if (type === STRING) return text();
    if (type !== ARRAY) return scalar(type);
    const itemType = u32();
    const count = length();
    const keep = itemType !== STRING && itemType !== ARRAY && count <= MAX_ARRAY;
    const items: unknown[] = [];
    const size = SIZES[itemType];
    if (!keep && size !== undefined) {
      need(size * count);
      offset += size * count;
      return undefined;
    }
    for (let index = 0; index < count; index++) {
      const item = value(itemType);
      if (keep) items.push(item);
    }
    return keep ? items : undefined;
  };

  const kv: Record<string, unknown> = {};
  try {
    // Version 1 counted in 32 bits; Ollama's registry serves 2 and 3.
    if (u32() < 2) return undefined;
    length(); // tensors
    const pairs = length();
    for (let pair = 0; pair < pairs; pair++) {
      const key = text();
      const read = value(u32());
      if (read !== undefined) kv[key] = read;
    }
    return { kv, complete: true };
  } catch (error) {
    if (error instanceof Truncated) return { kv, complete: false };
    return undefined;
  }
}
