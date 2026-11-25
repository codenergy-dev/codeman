import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENGINE_RELEASES, IMAGES_BEFORE_SALAD } from "../../src/inference/images.ts";
import { localPodImage, POD_IMAGE_ALLOWLIST } from "./pod-images.ts";

const OLLAMA = ENGINE_RELEASES.ollama?.image as string;
const VLLM = ENGINE_RELEASES.vllm?.image as string;

test("each engine's official image has its local e2e image", () => {
  assert.equal(localPodImage(OLLAMA), "codeman-e2e-pod-ollama:local");
  assert.equal(localPodImage(VLLM), "codeman-e2e-pod-vllm:local");
  assert.equal(POD_IMAGE_ALLOWLIST.size, 2);
  for (const image of POD_IMAGE_ALLOWLIST.keys()) assert.match(image, /@sha256:[0-9a-f]{64}$/);
});

test("any other image is refused, a pinned one's repository without its digest included", () => {
  const repository = OLLAMA.split("@")[0] as string;
  assert.throws(() => localPodImage(repository), /No e2e pod image stands in/);
  assert.throws(() => localPodImage(`${repository}:latest`), /No e2e pod image stands in/);
  assert.throws(() => localPodImage("ollama/ollama:0.35.1"), /No e2e pod image stands in/);
  // Codeman's own images, which pods no longer start from.
  for (const image of IMAGES_BEFORE_SALAD) assert.throws(() => localPodImage(image));
});

test("the local images start from the catalog's releases", () => {
  const dockerfile = (engine: string) =>
    readFileSync(new URL(`images/pod-${engine}/Dockerfile`, import.meta.url), "utf8");
  // Ollama's is the catalog's own image, by its digest.
  const [, ollamaDigest] = OLLAMA.split("@");
  assert.match(
    dockerfile("ollama"),
    new RegExp(`^FROM ollama/ollama:0\\.40\\.10@${ollamaDigest}$`, "m"),
  );
  assert.equal(ENGINE_RELEASES.ollama?.release.version, "0.40.10");
  // vLLM's is the CPU image of the catalog's release.
  const version = ENGINE_RELEASES.vllm?.release.version;
  assert.match(
    dockerfile("vllm"),
    new RegExp(
      `^FROM vllm/vllm-openai-cpu:v${version?.replaceAll(".", "\\.")}@sha256:[0-9a-f]{64}$`,
      "m",
    ),
  );
});
