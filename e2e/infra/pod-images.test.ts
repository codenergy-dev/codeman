import assert from "node:assert/strict";
import { test } from "node:test";
import { POD_IMAGES } from "../../src/inference/images.ts";
import { localPodImage, POD_IMAGE_ALLOWLIST } from "./pod-images.ts";

test("each of Codeman's pinned pod images has its local e2e image", () => {
  assert.equal(localPodImage(POD_IMAGES.ollama as string), "codeman-e2e-pod-ollama:local");
  assert.equal(localPodImage(POD_IMAGES.vllm as string), "codeman-e2e-pod-vllm:local");
  assert.equal(POD_IMAGE_ALLOWLIST.size, 2);
  for (const image of POD_IMAGE_ALLOWLIST.keys()) assert.match(image, /@sha256:[0-9a-f]{64}$/);
});

test("any other image is refused, a pinned one's repository without its digest included", () => {
  const repository = (POD_IMAGES.ollama as string).split("@")[0] as string;
  assert.throws(() => localPodImage(repository), /No e2e pod image stands in/);
  assert.throws(() => localPodImage(`${repository}:latest`), /No e2e pod image stands in/);
  assert.throws(() => localPodImage("ollama/ollama:0.35.1"), /No e2e pod image stands in/);
});
