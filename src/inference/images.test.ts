import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POD_IMAGES, podImage } from "./images.ts";
import { IMAGES_WITHOUT_OLLAMA_SETTINGS, OLLAMA_VERSION } from "./ollama.ts";
import { PROVIDERS } from "./providers.ts";
import { VLLM_MIN_CUDA, VLLM_VERSION } from "./vllm.ts";

const dockerfile = readFileSync("docker/pod/Dockerfile", "utf8");
const workflow = readFileSync(".github/workflows/pod-image.yml", "utf8");

test("an image per engine of pods, each a target of the Dockerfile and a leg of the workflow", () => {
  const engines = PROVIDERS["runpod-pod"].settings.engine?.values ?? [];
  assert.deepEqual(Object.keys(POD_IMAGES).sort(), [...engines].sort());
  const targets = [...dockerfile.matchAll(/^FROM \S+ AS ([a-z]+)$/gm)].map((match) => match[1]);
  assert.deepEqual(targets.filter((target) => target !== "node").sort(), [...engines].sort());
  assert.ok(workflow.includes(`engine: [${engines.join(", ")}]`));
  assert.match(
    workflow,
    /IMAGE: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/codeman-\$\{\{ matrix\.engine \}\}/,
  );
  for (const engine of engines) {
    const stage = dockerfile.split(`AS ${engine}\n`)[1]?.split(/^FROM /m)[0] ?? "";
    assert.ok(stage.includes(`ENV CODEMAN_IMAGE_ENGINE=${engine}`), engine);
    assert.ok(stage.includes('ENTRYPOINT ["node", "/opt/codeman/gateway.js"]'), engine);
  }
});

test("each pinned image is its engine's package by digest, or an older one known as such", () => {
  for (const [engine, image] of Object.entries(POD_IMAGES)) {
    if (image === "") continue;
    const own = new RegExp(`^ghcr\\.io/codenergy-dev/codeman-${engine}@sha256:[0-9a-f]{64}$`);
    assert.ok(
      own.test(image) || (engine === "ollama" && IMAGES_WITHOUT_OLLAMA_SETTINGS.has(image)),
      `${engine}: ${image}`,
    );
  }
});

test("the `pod-image` input overrides the Ollama image only", () => {
  assert.equal(podImage("ollama", "x@sha256:1"), "x@sha256:1");
  assert.equal(podImage("ollama"), POD_IMAGES.ollama);
  assert.equal(podImage("vllm", "x@sha256:1"), POD_IMAGES.vllm);
  assert.equal(podImage("sglang"), "");
});

test("the Dockerfile pins the engines' versions by digest, and vLLM sends no usage", () => {
  assert.ok(dockerfile.includes(`FROM ollama/ollama:${OLLAMA_VERSION}@sha256:`));
  assert.ok(dockerfile.includes(`FROM vllm/vllm-openai:v${VLLM_VERSION}@sha256:`));
  for (const from of dockerfile.matchAll(/^FROM (\S+)/gm)) {
    assert.match(from[1] ?? "", /@sha256:[0-9a-f]{64}$/, "every base by digest");
  }
  const vllm = dockerfile.split("AS vllm\n")[1]?.split(/^FROM /m)[0] ?? "";
  assert.ok(vllm.includes("VLLM_NO_USAGE_STATS=1") && vllm.includes("DO_NOT_TRACK=1"));
  const image = readFileSync(
    `docs/web/docker-hub/vllm-vllm-openai-v${VLLM_VERSION.replaceAll(".", "-")}.md`,
    "utf8",
  );
  assert.ok(image.includes(`\`CUDA_VERSION=${VLLM_MIN_CUDA}.`), "the image's CUDA is the floor");
  const pinned = /^FROM vllm\/vllm-openai:\S+@(sha256:[0-9a-f]{64})/m.exec(dockerfile)?.[1];
  assert.ok(pinned && image.includes(pinned), "the recorded index digest");
});
