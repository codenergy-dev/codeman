import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ENGINE_RELEASES,
  NODE_RELEASE,
  POD_IMAGES,
  podImage,
  type ReleaseArtifact,
} from "./images.ts";
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

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function checkRelease(name: string, release: ReleaseArtifact): void {
  assert.ok(release.name !== "", name);
  assert.match(release.version, SEMVER, `${name}: version`);
  assert.match(release.publishedAt, ISO, `${name}: publishedAt`);
  assert.ok(Date.parse(release.publishedAt) < Date.now(), `${name}: published in the past`);
  if (release.replaces !== undefined) {
    assert.match(release.replaces, SEMVER, `${name}: replaces`);
    assert.notEqual(release.replaces, release.version, `${name}: replaces another version`);
  }
  for (const [key, value] of Object.entries(release.provenance ?? {})) {
    assert.ok(typeof value === "boolean" || value !== "", `${name}: provenance ${key}`);
  }
}

/** The page of an image's tag in docs/web/docker-hub/, such as `vllm-vllm-openai-v0-32-0.md`. */
function imagePage(image: string, tag: string): string {
  const repository = image.replace(/^docker\.io\//, "").split("@")[0] ?? "";
  return readFileSync(
    `docs/web/docker-hub/${`${repository}-${tag}`.replaceAll(/[^a-z0-9]+/g, "-")}.md`,
    "utf8",
  );
}

test("the catalog pins each engine of pods by its official image's index digest", () => {
  const engines = PROVIDERS["runpod-pod"].settings.engine?.values ?? [];
  assert.deepEqual(Object.keys(ENGINE_RELEASES).sort(), [...engines].sort());
  for (const [engine, { image, release }] of Object.entries(ENGINE_RELEASES)) {
    assert.match(
      image,
      /^docker\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9._-]+@sha256:[0-9a-f]{64}$/,
      engine,
    );
    checkRelease(engine, release);
    assert.ok(release.osv && release.osv.ecosystem !== "" && release.osv.package !== "", engine);
    const tag = engine === "vllm" ? `v${release.version}` : release.version;
    const digest = image.split("@")[1] ?? "";
    assert.ok(imagePage(image, tag).includes(digest), `${engine}: the recorded index digest`);
  }
});

test("the catalog's vLLM image is built with the CUDA that vLLM pods require", () => {
  const { image, release } = ENGINE_RELEASES.vllm ?? assert.fail("no vllm");
  const page = imagePage(image, `v${release.version}`);
  assert.ok(page.includes(`\`CUDA_VERSION=${VLLM_MIN_CUDA}.`), "the image's CUDA is the floor");
});

test("every exception names an OSV.dev advisory once, recorded, with its reason", () => {
  const recorded = readdirSync("docs/web/osv").map((file) =>
    readFileSync(`docs/web/osv/${file}`, "utf8"),
  );
  for (const [engine, { exceptions }] of Object.entries(ENGINE_RELEASES)) {
    const ids = exceptions.map((exception) => exception.id);
    assert.equal(new Set(ids).size, ids.length, `${engine}: each advisory once`);
    for (const { id, reason } of exceptions) {
      assert.match(id, /^[A-Z]+-[A-Za-z0-9-]+$/, `${engine}: ${id}`);
      assert.ok(reason.trim().length >= 40, `${engine}: ${id} has a reason`);
      assert.ok(
        recorded.some((page) => page.includes(`url: https://osv.dev/vulnerability/${id}\n`)),
        `${engine}: ${id} is recorded in docs/web/osv/`,
      );
    }
  }
});

test("Node's tarball for the bootstrap is pinned by URL and SHA-256", () => {
  const { url, sha256, release } = NODE_RELEASE;
  checkRelease("node", release);
  assert.equal(
    url,
    `https://nodejs.org/dist/v${release.version}/node-v${release.version}-linux-x64.tar.gz`,
  );
  assert.match(sha256, /^[0-9a-f]{64}$/);
});
