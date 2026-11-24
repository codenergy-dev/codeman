import assert from "node:assert/strict";
import { test } from "node:test";
import { ggufHeader, QWEN25_05B_INFO, QWEN25_05B_WEIGHTS } from "../testing/gguf.ts";
import { HEADER_BYTES, OllamaRegistry, registryName } from "./ollama-registry.ts";

const MODEL = `sha256:${"c".repeat(64)}`;
const PROJECTOR = `sha256:${"d".repeat(64)}`;

function manifest(layers: { mediaType: string; digest: string; size: number }[]) {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: "x", size: 1 },
    layers,
  };
}

/** The registry, in memory: each request, and its answer. */
function registry(answers: Record<string, Response | (() => Response)>) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    const answer = answers[url];
    if (!answer) return new Response("{}", { status: 404 });
    return typeof answer === "function" ? answer() : answer;
  }) as typeof fetch;
  return { registry: new OllamaRegistry(fetchFn), calls };
}

const BASE = "https://registry.ollama.ai/v2/library/qwen2.5";

test("a model's name is read as Ollama reads it", () => {
  assert.deepEqual(registryName("qwen2.5:0.5b"), {
    host: "registry.ollama.ai",
    namespace: "library",
    model: "qwen2.5",
    tag: "0.5b",
  });
  assert.deepEqual(registryName("someone/model"), {
    host: "registry.ollama.ai",
    namespace: "someone",
    model: "model",
    tag: "latest",
  });
  assert.equal(registryName("hf.co/someone/model:q4")?.host, "hf.co");
  assert.equal(registryName("a/b/c/d"), undefined);
  assert.equal(registryName("model:"), undefined);
});

test("a model's facts: its weights from the manifest, its metadata from a ranged read", async () => {
  const header = ggufHeader(QWEN25_05B_INFO, 100);
  const { registry: hub, calls } = registry({
    [`${BASE}/manifests/0.5b`]: Response.json(
      manifest([
        {
          mediaType: "application/vnd.ollama.image.model",
          digest: MODEL,
          size: QWEN25_05B_WEIGHTS,
        },
        { mediaType: "application/vnd.ollama.image.projector", digest: PROJECTOR, size: 1000 },
        { mediaType: "application/vnd.ollama.image.license", digest: "y", size: 11_343 },
      ]),
    ),
    [`${BASE}/blobs/${MODEL}`]: () => new Response(header, { status: 206 }),
  });
  const facts = await hub.model("qwen2.5:0.5b");
  assert.ok("info" in facts);
  assert.equal(facts.weightsBytes, QWEN25_05B_WEIGHTS + 1000);
  assert.equal(facts.info["qwen2.block_count"], 24);
  assert.equal(
    calls[0]?.headers.get("accept"),
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  assert.equal(calls[1]?.headers.get("range"), `bytes=0-${HEADER_BYTES - 1}`);
  assert.equal(calls.length, 2);
});

test("a registry that ignores the range is read only up to its limit", async () => {
  const header = ggufHeader(QWEN25_05B_INFO, 50_000);
  assert.ok(header.byteLength > HEADER_BYTES);
  const { registry: hub } = registry({
    [`${BASE}/manifests/latest`]: Response.json(
      manifest([{ mediaType: "application/vnd.ollama.image.model", digest: MODEL, size: 5 }]),
    ),
    [`${BASE}/blobs/${MODEL}`]: () => new Response(header, { status: 200 }),
  });
  const facts = await hub.model("qwen2.5");
  assert.ok("info" in facts);
  assert.equal(facts.info["qwen2.context_length"], 32_768);
});

test("what the registry cannot tell is said, never thrown", async () => {
  const list = {
    schemaVersion: 2,
    mediaType: "application/vnd.ollama.manifest.list.v2+json",
    manifests: [],
  };
  const cases: [string, Record<string, Response | (() => Response)>, RegExp][] = [
    ["hf.co/someone/model", {}, /is on hf\.co, not on Ollama's registry/],
    ["qwen2.5:0.5b", {}, /answered 404/],
    ["qwen2.5:0.5b", { [`${BASE}/manifests/0.5b`]: Response.json(list) }, /manifest list/],
    [
      "qwen2.5:0.5b",
      {
        [`${BASE}/manifests/0.5b`]: Response.json(
          manifest([{ mediaType: "application/vnd.ollama.image.model", digest: MODEL, size: 1 }]),
        ),
        [`${BASE}/blobs/${MODEL}`]: () => new Response("safetensors", { status: 206 }),
      },
      /not a GGUF file/,
    ],
    [
      "qwen2.5:0.5b",
      {
        [`${BASE}/manifests/0.5b`]: () => {
          throw new TypeError("fetch failed");
        },
      },
      /could not be read \(fetch failed\)/,
    ],
  ];
  for (const [name, answers, why] of cases) {
    const facts = await registry(answers).registry.model(name);
    assert.ok("unknown" in facts, name);
    assert.match(facts.unknown, why);
  }
});
