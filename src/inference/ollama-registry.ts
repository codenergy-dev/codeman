import { ggufMetadata } from "./gguf.ts";

/**
 * What Codeman reads of an Ollama model in Ollama's registry before it creates a pod for it, to
 * estimate its fit (docs/plans/2026-11-23-estimate-the-fit-before-creating-a-pod.md): the bytes
 * of its weights, and its GGUF metadata, the keys `/api/show`'s `model_info` gives.
 */
export interface OllamaModelFacts {
  /** Bytes of its model and projector layers, which the pod loads on the GPU. */
  weightsBytes: number;
  /** Its GGUF metadata, such as `general.architecture` and `qwen2.block_count`. */
  info: Readonly<Record<string, unknown>>;
}

/** A source of Ollama models' facts, such as Ollama's registry. */
export interface OllamaModels {
  /** The model's facts, or why they cannot be read. */
  model(name: string): Promise<OllamaModelFacts | { unknown: string }>;
}

/** The registry Ollama pulls a bare name from (`types/model/name.go`, docs/web/ollama/). */
export const OLLAMA_REGISTRY = "registry.ollama.ai";
const MANIFEST = "application/vnd.docker.distribution.manifest.v2+json";
const MODEL_LAYER = "application/vnd.ollama.image.model";
const PROJECTOR_LAYER = "application/vnd.ollama.image.projector";
/**
 * Bytes read from the head of the model's blob: its metadata's architecture keys come within the
 * first few kilobytes, before the tokenizer's vocabulary, which is not needed.
 */
export const HEADER_BYTES = 256 * 1024;

/** A model's name in the registry: `[host/][namespace/]model[:tag]`, as Ollama parses it. */
export function registryName(
  name: string,
): { host: string; namespace: string; model: string; tag: string } | undefined {
  let rest = name;
  let tag = "latest";
  if (rest.lastIndexOf(":") > rest.lastIndexOf("/")) {
    tag = rest.slice(rest.lastIndexOf(":") + 1);
    rest = rest.slice(0, rest.lastIndexOf(":"));
  }
  const parts = rest.split("/");
  if (parts.length > 3 || parts.some((part) => part === "") || tag === "") return undefined;
  const model = parts.pop() as string;
  const namespace = parts.pop() ?? "library";
  const host = parts.pop() ?? OLLAMA_REGISTRY;
  return { host, namespace, model, tag };
}

/**
 * Ollama's registry, without a token, as each pod pulls its model: the model's manifest
 * (`pullModelManifest` in `server/images.go`), then the first 256 KiB of its model layer, by a
 * ranged read (`server/download.go`). Gives why it cannot tell instead of failing: a model on
 * another registry, a manifest list, a layer that is not GGUF, or a request that fails.
 */
export class OllamaRegistry implements OllamaModels {
  readonly #fetch: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.#fetch = fetchFn;
  }

  async model(name: string): Promise<OllamaModelFacts | { unknown: string }> {
    const parsed = registryName(name.toLowerCase());
    if (!parsed) return { unknown: `\`${name}\` is not a model name Ollama's registry knows.` };
    if (parsed.host !== OLLAMA_REGISTRY) {
      return { unknown: `\`${name}\` is on ${parsed.host}, not on Ollama's registry.` };
    }
    const base = `https://${OLLAMA_REGISTRY}/v2/${encodeURIComponent(parsed.namespace)}/${encodeURIComponent(parsed.model)}`;
    try {
      const response = await this.#fetch(`${base}/manifests/${encodeURIComponent(parsed.tag)}`, {
        headers: { Accept: MANIFEST },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return { unknown: `Ollama's registry answered ${response.status}.` };
      const manifest = (await response.json()) as {
        mediaType?: unknown;
        layers?: { mediaType?: unknown; digest?: unknown; size?: unknown }[];
      };
      if (manifest.mediaType !== MANIFEST || !Array.isArray(manifest.layers)) {
        return { unknown: "Ollama's registry gave a manifest list, or no manifest." };
      }
      const weights = manifest.layers.filter(
        (layer) => layer.mediaType === MODEL_LAYER || layer.mediaType === PROJECTOR_LAYER,
      );
      const model = weights.find((layer) => layer.mediaType === MODEL_LAYER);
      if (
        !model ||
        typeof model.digest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(model.digest) ||
        !weights.every((layer) => typeof layer.size === "number" && layer.size >= 0)
      ) {
        return { unknown: "Its manifest has no model layer with a digest and a size." };
      }
      const head = await this.#fetch(`${base}/blobs/${model.digest}`, {
        headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (head.status !== 206 && head.status !== 200) {
        return { unknown: `Ollama's registry answered ${head.status} for its model layer.` };
      }
      const bytes = await firstBytes(head, HEADER_BYTES);
      const metadata = ggufMetadata(bytes);
      if (!metadata) return { unknown: "Its model layer is not a GGUF file." };
      return {
        weightsBytes: weights.reduce((total, layer) => total + (layer.size as number), 0),
        info: metadata.kv,
      };
    } catch (error) {
      return {
        unknown: `Ollama's registry could not be read (${error instanceof Error ? error.message : error}).`,
      };
    }
  }
}

/** Up to `limit` bytes of a body, without reading the rest, should the server ignore the range. */
async function firstBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.byteLength - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset === bytes.byteLength) break;
  }
  return bytes;
}
