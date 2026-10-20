import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import {
  downloadOpenCode,
  OPENCODE_PACKAGES,
  OPENCODE_VERSION,
} from "../../../src/harness/opencode.ts";
import { fill, fromEnv, integrityOf, NpmCache, PINNED, packagesFor } from "./npm.ts";

const NAME = "opencode-linux-x64";
const FILE = `${NAME}-${OPENCODE_VERSION}.tgz`;
const REGISTRY_URL = `https://registry.npmjs.org/${NAME}/-/${FILE}`;
/** A small synthetic tarball, and the integrity a package pinned to it would have. */
const TARBALL = randomBytes(4096);
const INTEGRITY = integrityOf(TARBALL);

const dir = mkdtempSync(join(tmpdir(), "codeman-npm-"));
const cache = new NpmCache(dir);
let origin = "";
let redirected: typeof fetch = fetch;
before(async () => {
  origin = await cache.server.listen();
  redirected = redirects({ CODEMAN_E2E_ENDPOINTS: JSON.stringify({ npm: origin }) }).fetch;
});
after(async () => {
  await cache.server.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  cache.server.reset();
  for (const file of readdirSync(dir)) rmSync(join(dir, file), { force: true });
});

/** A `fetch` that answers every request with `body`, and the URLs it was asked for. */
function registry(body: Uint8Array): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (input) => {
      urls.push(String(input));
      return new Response(body);
    },
  };
}

test("serves a cached tarball, and Codeman's integrity check passes on it", async () => {
  writeFileSync(join(dir, FILE), TARBALL);
  const tarball = await downloadOpenCode({ name: NAME, integrity: INTEGRITY }, redirected);
  assert.deepEqual(tarball, TARBALL);
  assert.deepEqual(
    cache.server.requests.map((request) => [request.method, request.path]),
    [["GET", `/${NAME}/-/${FILE}`]],
  );
});

test("a tarball with other content fails Codeman's integrity check", async () => {
  writeFileSync(join(dir, FILE), TARBALL);
  await assert.rejects(
    downloadOpenCode({ name: NAME, integrity: integrityOf(randomBytes(4096)) }, redirected),
    /does not match its pinned integrity/,
  );
  const pinned = OPENCODE_PACKAGES["linux-x64"];
  assert.ok(pinned);
  await assert.rejects(downloadOpenCode(pinned, redirected), /does not match its pinned integrity/);
});

test("serves only the pinned packages' tarballs; anything else is a 404", async () => {
  for (const file of [FILE, "left-pad-1.3.0.tgz", `${NAME}-1.0.0.tgz`]) {
    writeFileSync(join(dir, file), TARBALL);
  }
  const paths = [
    `/left-pad/-/left-pad-1.3.0.tgz`,
    `/${NAME}/-/${NAME}-1.0.0.tgz`,
    `/opencode-linux-arm64/-/${FILE}`,
    `/${NAME}`,
    `/${NAME}/${OPENCODE_VERSION}`,
    `/${NAME}/-/..%2F..%2Fetc%2Fpasswd`,
  ];
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    await response.arrayBuffer();
  }
  const head = await fetch(`${origin}/${NAME}/-/${FILE}`, { method: "POST" });
  assert.equal(head.status, 404);
});

test("a pinned package missing from the cache is a 404, which fails Codeman's download", async () => {
  await assert.rejects(
    downloadOpenCode({ name: NAME, integrity: INTEGRITY }, redirected),
    /failed with 404/,
  );
});

test("serves OpenCode's pinned platform packages by default", () => {
  assert.deepEqual(PINNED, [
    { name: "opencode-linux-x64", version: OPENCODE_VERSION },
    { name: "opencode-linux-arm64", version: OPENCODE_VERSION },
  ]);
});

test("fill downloads each tarball once from the real registry's URL", async () => {
  const fake = registry(TARBALL);
  const packages = [{ name: NAME, integrity: INTEGRITY }];
  assert.deepEqual(await fill(dir, packages, fake.fetch), [FILE]);
  assert.deepEqual(readFileSync(join(dir, FILE)), TARBALL);
  assert.deepEqual(await fill(dir, packages, fake.fetch), []);
  assert.deepEqual(fake.urls, [REGISTRY_URL]);
  assert.deepEqual(readdirSync(dir), [FILE]);
});

test("fill refuses a tarball that does not match its pinned integrity, and stores nothing", async () => {
  const fake = registry(randomBytes(4096));
  await assert.rejects(
    fill(dir, [{ name: NAME, integrity: INTEGRITY }], fake.fetch),
    /does not match its pinned integrity/,
  );
  assert.deepEqual(readdirSync(dir), []);
});

test("fill replaces a cached tarball that no longer matches", async () => {
  writeFileSync(join(dir, FILE), "tampered");
  const fake = registry(TARBALL);
  assert.deepEqual(await fill(dir, [{ name: NAME, integrity: INTEGRITY }], fake.fetch), [FILE]);
  assert.deepEqual(readFileSync(join(dir, FILE)), TARBALL);
});

test("fill takes only OpenCode's pinned platforms", () => {
  assert.deepEqual(packagesFor(["linux-x64"]), [OPENCODE_PACKAGES["linux-x64"]]);
  assert.throws(() => packagesFor(["darwin-arm64"]), /No OpenCode package is pinned for darwin/);
});

test("fromEnv needs the cache's directory", () => {
  assert.throws(() => fromEnv({}), /FAKE_NPM_CACHE/);
  assert.equal(fromEnv({ FAKE_NPM_CACHE: dir }).name, "npm");
});
