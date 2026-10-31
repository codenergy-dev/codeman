import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { NODE_RELEASE, type NodeRelease } from "../../../src/inference/images.ts";
import { fill, NodeDist } from "./nodejs.ts";

const TARBALL = randomBytes(4096);
const RELEASE: NodeRelease = {
  ...NODE_RELEASE,
  sha256: createHash("sha256").update(TARBALL).digest("hex"),
};
const FILE = "node-v24.22.1-linux-x64.tar.gz";

const dir = mkdtempSync(join(tmpdir(), "codeman-nodejs-"));
const dist = new NodeDist(dir, RELEASE);
let origin = "";
before(async () => {
  origin = await dist.server.listen();
});
after(async () => {
  await dist.server.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  dist.server.reset();
  for (const file of readdirSync(dir)) rmSync(join(dir, file), { force: true });
});

test("serves the pinned tarball at its path under /dist/, and nothing else", async () => {
  writeFileSync(join(dir, FILE), TARBALL);
  writeFileSync(join(dir, "SHASUMS256.txt"), "x");
  const path = new URL(RELEASE.url).pathname;
  const answer = await fetch(`${origin}${path}`);
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get("content-length"), String(TARBALL.length));
  assert.deepEqual(Buffer.from(await answer.arrayBuffer()), TARBALL);
  for (const other of [
    "/dist/v24.22.1/SHASUMS256.txt",
    "/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz",
  ]) {
    assert.equal((await fetch(`${origin}${other}`)).status, 404, other);
  }
});

test("an empty cache answers 404, saying to fill it", async () => {
  const answer = await fetch(`${origin}${new URL(RELEASE.url).pathname}`);
  assert.equal(answer.status, 404);
  assert.match(await answer.text(), /run fill\.ts/);
});

test("fill stores only a tarball of the pinned SHA-256, and keeps a filled cache", async () => {
  const urls: string[] = [];
  const serving = (body: Uint8Array) =>
    (async (url: string) => {
      urls.push(String(url));
      return new Response(body);
    }) as typeof fetch;
  await assert.rejects(
    fill(dir, RELEASE, serving(randomBytes(4096))),
    /Refused .*: its SHA-256 is/,
  );
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(await fill(dir, RELEASE, serving(TARBALL)), true);
  assert.deepEqual(readdirSync(dir), [FILE]);
  assert.equal(await fill(dir, RELEASE, serving(TARBALL)), false);
  assert.deepEqual(urls, [RELEASE.url, RELEASE.url]);
});
