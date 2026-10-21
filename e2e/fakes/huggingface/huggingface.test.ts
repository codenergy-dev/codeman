import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { HuggingFace } from "../../../src/inference/huggingface.ts";
import {
  cacheModels,
  FIXTURE,
  fixtureModels,
  fromEnv,
  type HubRepo,
  HuggingFaceFake,
} from "./huggingface.ts";

/**
 * Codeman's own Hub client against the fake, as the e2e build wires it: `redirects` swaps
 * `https://huggingface.co` for the fake's origin.
 */

const MODEL = "Qwen/Qwen2.5-0.5B-Instruct";
const REVISION = "7ae557604adf67be50417f59c2c2f167def9a775";
const WEIGHTS = 988_097_824;

/** The model's information, as the fake answers it. */
async function info(url: string): Promise<{ sha: string; siblings: Record<string, unknown>[] }> {
  return (await fetch(url)).json() as Promise<{ sha: string; siblings: Record<string, unknown>[] }>;
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, HubRepo>;
const fake = new HuggingFaceFake(fixtureModels(fixture));
let hub: HuggingFace;
let origin = "";
before(async () => {
  origin = await fake.server.listen();
  hub = new HuggingFace(
    redirects({ CODEMAN_E2E_ENDPOINTS: JSON.stringify({ huggingFace: origin }) }).fetch,
  );
});
after(() => fake.server.close());
beforeEach(() => fake.server.reset());

test("Codeman's client reads the pinned model's weights from the fixture", async () => {
  assert.deepEqual(await hub.model(MODEL), { id: MODEL, weightsBytes: WEIGHTS });
  assert.deepEqual(
    fake.server.requests.map((request) => [request.method, request.path, request.query]),
    [["GET", `/api/models/${MODEL}`, "?blobs=true"]],
  );
  const answer = await info(`${origin}/api/models/${MODEL}?blobs=true`);
  assert.equal(answer.sha, REVISION);
  assert.deepEqual(
    answer.siblings.find((file) => file.rfilename === "model.safetensors"),
    {
      rfilename: "model.safetensors",
      size: WEIGHTS,
      lfs: {
        sha256: "fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe",
        size: WEIGHTS,
      },
    },
  );
  // Without blobs, the Hub gives no size.
  const bare = await info(`${origin}/api/models/${MODEL}`);
  assert.deepEqual(bare.siblings[0], { rfilename: ".gitattributes" });
});

test("a model the fake does not have is not public, as the Hub answers", async () => {
  const response = await fetch(`${origin}/api/models/Qwen/qwen2.5-0.5b-instruct?blobs=true`);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-error-message"), "Invalid username or password.");
  await assert.rejects(
    hub.model("acme/missing"),
    /Hugging Face has no public model `acme\/missing`/,
  );
  // The fake serves no other route, such as a revision's.
  const revision = await fetch(`${origin}/api/models/${MODEL}/revision/${REVISION}`);
  assert.equal(revision.status, 404);
});

test("the shared faults make the Hub fail for Codeman", async () => {
  fake.server.fault({ path: "/api/models/{namespace}/{name}", status: 503, times: 1 });
  await assert.rejects(hub.model(MODEL), /Hugging Face's API answered 503/);
  assert.equal((await hub.model(MODEL)).weightsBytes, WEIGHTS);
});

test("a cache directory gives each file's size and hash from its blob", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeman-hf-"));
  try {
    const repo = join(dir, "models--acme--tiny");
    const weights = "a".repeat(64);
    const config = "b".repeat(40);
    mkdirSync(join(repo, "blobs"), { recursive: true });
    mkdirSync(join(repo, "refs"));
    mkdirSync(join(repo, "snapshots", REVISION, "onnx"), { recursive: true });
    writeFileSync(join(repo, "blobs", weights), Buffer.alloc(4096));
    writeFileSync(join(repo, "blobs", config), "{}\n");
    writeFileSync(join(repo, "refs", "main"), `${REVISION}\n`);
    const snapshot = join(repo, "snapshots", REVISION);
    symlinkSync(`../../blobs/${weights}`, join(snapshot, "model.safetensors"));
    symlinkSync(`../../blobs/${config}`, join(snapshot, "config.json"));
    writeFileSync(join(snapshot, "onnx", "model.onnx"), "x");
    const cached = new HuggingFaceFake(cacheModels(dir));
    const cachedOrigin = await cached.server.listen();
    try {
      const cachedHub = new HuggingFace(
        redirects({ CODEMAN_E2E_ENDPOINTS: JSON.stringify({ huggingFace: cachedOrigin }) }).fetch,
      );
      assert.deepEqual(await cachedHub.model("acme/tiny"), { id: "acme/tiny", weightsBytes: 4096 });
      const answer = await info(`${cachedOrigin}/api/models/acme/tiny?blobs=true`);
      assert.equal(answer.sha, REVISION);
      assert.deepEqual(answer.siblings, [
        { rfilename: "config.json", size: 3, blobId: config },
        { rfilename: "model.safetensors", size: 4096, lfs: { sha256: weights, size: 4096 } },
        { rfilename: "onnx/model.onnx", size: 1 },
      ]);
      await assert.rejects(cachedHub.model("acme/other"), /no public model/);
    } finally {
      await cached.server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main's module serves the cache it is given, or the fixture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeman-hf-empty-"));
  const servers = [await fromEnv({ FAKE_HUGGINGFACE_CACHE: dir }), await fromEnv({})];
  try {
    const [empty, bundled] = await Promise.all(servers.map((server) => server.listen()));
    assert.equal((await fetch(`${empty}/api/models/${MODEL}`)).status, 401);
    assert.equal((await fetch(`${bundled}/api/models/${MODEL}`)).status, 200);
  } finally {
    for (const server of servers) await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
