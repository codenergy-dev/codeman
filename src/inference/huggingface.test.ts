import assert from "node:assert/strict";
import { test } from "node:test";
import { HuggingFace } from "./huggingface.ts";

function hub(...responses: Response[]): { hub: HuggingFace; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return responses.shift() ?? new Response("{}", { status: 500 });
  }) as typeof fetch;
  return { hub: new HuggingFace(fetchFn), calls };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const model = {
  id: "unsloth/Qwen3.8-27B-NVFP4",
  private: false,
  gated: false,
  disabled: false,
  siblings: [
    { rfilename: "config.json", size: 4_000 },
    { rfilename: "model-00001-of-00002.safetensors", size: 15_000_000_000 },
    { rfilename: "model-00002-of-00002.safetensors", size: 8_400_000_000 },
  ],
  usedStorage: 23_500_000_000,
};

test("reads a public model's weights, once, without a token", async () => {
  const { hub: huggingFace, calls } = hub(json(model));
  assert.deepEqual(await huggingFace.model("unsloth/Qwen3.8-27B-NVFP4"), {
    id: "unsloth/Qwen3.8-27B-NVFP4",
    weightsBytes: 23_400_000_000,
  });
  const [url, init] = calls[0] ?? [];
  assert.equal(url, "https://huggingface.co/api/models/unsloth/Qwen3.8-27B-NVFP4?blobs=true");
  assert.equal(new Headers(init?.headers).get("authorization"), null);
  assert.equal(calls.length, 1);
});

test("without the files' sizes, the repository's storage", async () => {
  const siblings = model.siblings.map(({ rfilename }) => ({ rfilename }));
  const { hub: huggingFace } = hub(
    json({ ...model, siblings }),
    json({ ...model, siblings, usedStorage: undefined }),
  );
  assert.equal((await huggingFace.model("a/b")).weightsBytes, 23_500_000_000);
  await assert.rejects(huggingFace.model("a/b"), /does not give the size of `a\/b`'s weights/);
});

test("a missing, private, gated, disabled or GGUF model stops the run, saying what to change", async () => {
  const { hub: huggingFace } = hub(
    new Response('{"error":"Repository not found"}', { status: 401 }),
    new Response("{}", { status: 404 }),
    json({ ...model, gated: "manual" }),
    json({ ...model, gated: "auto" }),
    json({ ...model, disabled: true }),
    json({ ...model, siblings: [{ rfilename: "model-Q4_K_M.gguf", size: 1 }] }),
    new Response("{}", { status: 503, headers: { "X-Error-Message": "Overloaded" } }),
  );
  await assert.rejects(
    huggingFace.model("a/b"),
    /^Error: Hugging Face has no public model `a\/b`: check its ID, whose case counts/,
  );
  await assert.rejects(huggingFace.model("a/b"), /no public model/);
  await assert.rejects(huggingFace.model("a/b"), /`a\/b` is gated on Hugging Face/);
  await assert.rejects(huggingFace.model("a/b"), /is gated/);
  await assert.rejects(huggingFace.model("a/b"), /`a\/b` is disabled on Hugging Face/);
  await assert.rejects(huggingFace.model("a/b"), /has no safetensors weights/);
  await assert.rejects(
    huggingFace.model("a/b"),
    /Hugging Face's API answered 503 for `a\/b` \(Overloaded\), so no pod was created/,
  );
  await assert.rejects(huggingFace.model("not-an-id"), /not a Hugging Face model ID/);
});

test("a model reads images when its configuration has a vision tower that vLLM serves", async () => {
  const config = {
    architectures: ["Qwen3_5ForConditionalGeneration"],
    vision_config: { depth: 27 },
  };
  const { hub: huggingFace, calls } = hub(
    json(config),
    json({ ...config, language_model_only: false }),
    json({ architectures: ["Qwen2ForCausalLM"] }),
    json({ ...config, language_model_only: true }),
    json({ ...config, vision_config: null }),
  );
  assert.equal(await huggingFace.vision("unsloth/Qwen3.8-27B-NVFP4"), true);
  assert.equal(await huggingFace.vision("a/b"), true);
  assert.equal(await huggingFace.vision("a/b"), false, "no vision tower");
  assert.equal(await huggingFace.vision("a/b"), false, "the model serves its language model only");
  assert.equal(await huggingFace.vision("a/b"), false);
  const [url, init] = calls[0] ?? [];
  assert.equal(url, "https://huggingface.co/unsloth/Qwen3.8-27B-NVFP4/resolve/main/config.json");
  assert.equal(new Headers(init?.headers).get("authorization"), null);
});

test("a configuration that cannot be read says why", async () => {
  const { hub: huggingFace } = hub(
    new Response("{}", { status: 404 }),
    new Response("not json", { status: 200 }),
  );
  await assert.rejects(huggingFace.vision("a/b"), /^Error: Hugging Face answered 404\.$/);
  await assert.rejects(huggingFace.vision("a/b"), /^Error: Its config\.json is not JSON\.$/);
  await assert.rejects(huggingFace.vision("not-an-id"), /not a Hugging Face model ID/);
  const failing = new HuggingFace((async () => {
    throw new Error("network down");
  }) as typeof fetch);
  await assert.rejects(
    failing.vision("a/b"),
    /^Error: Hugging Face could not be reached \(network down\)\.$/,
  );
});

test("an unreachable API stops the run before any pod", async () => {
  const failing = new HuggingFace((async () => {
    throw new Error("network down");
  }) as typeof fetch);
  await assert.rejects(
    failing.model("a/b"),
    /Could not reach Hugging Face's API to check `a\/b` \(network down\)/,
  );
});
