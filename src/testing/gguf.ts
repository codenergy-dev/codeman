/**
 * GGUF headers for tests, written as llama.cpp and Ollama write them (version 3, little-endian):
 * `general.*` first, then the architecture's keys, then a tokenizer vocabulary, an array of
 * strings that the readers skip. Numbers are `uint32` when whole and `float32` otherwise; an
 * array of numbers is an array of `uint32`.
 */

export type GgufValue = string | number | boolean | number[] | string[];

const UINT32 = 4;
const FLOAT32 = 6;
const BOOL = 7;
const STRING = 8;
const ARRAY = 9;

export function ggufHeader(kv: Readonly<Record<string, GgufValue>>, tokens = 0): Uint8Array {
  const parts: Uint8Array[] = [];
  const u32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    parts.push(bytes);
  };
  const u64 = (value: number) => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
    parts.push(bytes);
  };
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    u64(bytes.byteLength);
    parts.push(bytes);
  };
  const scalar = (value: number | boolean) => {
    if (typeof value === "boolean") {
      parts.push(new Uint8Array([value ? 1 : 0]));
    } else if (Number.isInteger(value)) {
      u32(value);
    } else {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setFloat32(0, value, true);
      parts.push(bytes);
    }
  };
  const type = (value: GgufValue) =>
    typeof value === "string"
      ? STRING
      : typeof value === "boolean"
        ? BOOL
        : Array.isArray(value)
          ? ARRAY
          : Number.isInteger(value)
            ? UINT32
            : FLOAT32;
  const entries: [string, GgufValue][] = Object.entries(kv);
  if (tokens > 0) {
    entries.push(["tokenizer.ggml.tokens", Array.from({ length: tokens }, (_, i) => `t${i}`)]);
  }
  parts.push(new TextEncoder().encode("GGUF"));
  u32(3);
  u64(0);
  u64(entries.length);
  for (const [key, value] of entries) {
    text(key);
    u32(type(value));
    if (Array.isArray(value)) {
      const strings = value.some((item) => typeof item === "string");
      u32(strings ? STRING : UINT32);
      u64(value.length);
      for (const item of value) {
        if (typeof item === "string") text(item);
        else u32(item);
      }
    } else if (typeof value === "string") text(value);
    else scalar(value);
  }
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** `qwen2.5:0.5b`'s metadata in Ollama's registry, as its model layer's header gives it. */
export const QWEN25_05B_INFO = {
  "general.architecture": "qwen2",
  "general.name": "Qwen2.5 0.5B Instruct",
  "qwen2.block_count": 24,
  "qwen2.context_length": 32768,
  "qwen2.embedding_length": 896,
  "qwen2.feed_forward_length": 4864,
  "qwen2.attention.head_count": 14,
  "qwen2.attention.head_count_kv": 2,
  "qwen2.rope.freq_base": 1000000.5,
  "general.file_type": 15,
} as const;

/** `qwen2.5:0.5b`'s model layer in Ollama's registry: its weights' bytes. */
export const QWEN25_05B_WEIGHTS = 397_807_936;

/** `Qwen/Qwen2.5-0.5B-Instruct`'s `config.json` (docs/web/hugging-face/), the fields read. */
export const QWEN25_05B_CONFIG = {
  architectures: ["Qwen2ForCausalLM"],
  model_type: "qwen2",
  torch_dtype: "bfloat16",
  hidden_size: 896,
  max_position_embeddings: 32768,
  max_window_layers: 21,
  num_attention_heads: 14,
  num_hidden_layers: 24,
  num_key_value_heads: 2,
  sliding_window: 32768,
  use_sliding_window: false,
} as const;

/** `Qwen/Qwen2.5-0.5B-Instruct`'s safetensors weights, in bytes. */
export const QWEN25_05B_SAFETENSORS = 988_097_824;
