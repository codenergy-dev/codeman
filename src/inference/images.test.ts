import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { catalogRelease, ENGINE_RELEASES, NODE_RELEASE, podImage } from "./images.ts";
import { OLLAMA_VERSION } from "./ollama.ts";
import { PROVIDERS } from "./providers.ts";
import type { ReleaseArtifact } from "./release-policy.ts";
import { VLLM_MIN_CUDA, VLLM_VERSION } from "./vllm.ts";

test("pods run the catalog's official images; the `pod-image` input overrides Ollama's only", () => {
  assert.equal(podImage("ollama", "x@sha256:1"), "x@sha256:1");
  assert.equal(podImage("ollama"), ENGINE_RELEASES.ollama?.image);
  assert.equal(podImage("vllm", "x@sha256:1"), ENGINE_RELEASES.vllm?.image);
  assert.equal(podImage("sglang"), "");
  // The release policy checks the catalog's images, and not one the input chose.
  assert.equal(catalogRelease("ollama", podImage("ollama")), ENGINE_RELEASES.ollama);
  assert.equal(catalogRelease("ollama", "x@sha256:1"), undefined);
  assert.equal(catalogRelease("sglang", ""), undefined);
});

test("the engines' versions that settings and messages name are the catalog's", () => {
  assert.equal(ENGINE_RELEASES.ollama?.release.version, OLLAMA_VERSION);
  assert.equal(ENGINE_RELEASES.vllm?.release.version, VLLM_VERSION);
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
