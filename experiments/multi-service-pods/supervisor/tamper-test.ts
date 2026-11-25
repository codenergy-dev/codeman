/**
 * Proves that the in-pod downloader refuses a tampered artifact, and with it the whole install:
 * a local HTTP server serves three files, one of them altered after the resolution hashed it.
 *
 * Usage: node tamper-test.ts <empty scratch directory>
 *   Exits 1 if the downloader accepts anything it should refuse.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { download, type Resolution } from "./downloader.ts";

const scratch = resolve(process.argv[2] ?? "");
if (!process.argv[2] || (existsSync(scratch) && readdirSync(scratch).length > 0)) {
  console.error("Usage: node tamper-test.ts <empty scratch directory>");
  process.exit(2);
}
const served = join(scratch, "served");
mkdirSync(served, { recursive: true });

// Three artifacts, hashed as a resolution would: then the server's copy of one is altered.
const names = ["engine-1.0-py3-none-any.whl", "dependency-2.0-py3-none-any.whl", "weights.bin"];
const artifacts = names.map((name) => {
  const bytes = randomBytes(8 * 1024 * 1024);
  writeFileSync(join(served, name), bytes);
  return { name, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
});
const tampered = readFileSync(join(served, "dependency-2.0-py3-none-any.whl"));
tampered[1000] = (tampered[1000] as number) ^ 0xff;
writeFileSync(join(served, "dependency-2.0-py3-none-any.whl"), tampered);

const server = createServer((request, response) => {
  const file = join(served, (request.url ?? "/").slice(1));
  if (!existsSync(file)) return void response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

function resolution(only?: string[]): Resolution {
  return {
    engine: "tamper-test",
    format: "python-wheels",
    artifacts: artifacts
      .filter((artifact) => !only || only.includes(artifact.name))
      .map((artifact) => ({ ...artifact, version: "1", url: `${base}/${artifact.name}` })),
  };
}

let failed = false;
function check(condition: boolean, what: string): void {
  console.log(`${condition ? "PROVED" : "FAILED"}: ${what}`);
  if (!condition) failed = true;
}

// 1. The set with the tampered file is refused whole: the two good files do not land either.
const refused = join(scratch, "refused");
const started = Date.now();
const error = await download(resolution(), refused, () => {}).then(
  () => undefined,
  (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
);
console.log(`Refused in ${Date.now() - started} ms: ${error}`);
check(error?.includes("SHA-256 mismatch") === true, "the tampered artifact is refused");
check(!existsSync(refused), "nothing reaches the destination, not even the good artifacts");
check(
  readdirSync(scratch).every((entry) => !entry.includes(".partial-")),
  "the staging directory is removed",
);

// 2. A body longer than the resolution says stops the download.
const long = resolution(["weights.bin"]);
(long.artifacts[0] as { size: number }).size -= 1;
const tooLong = await download(long, join(scratch, "too-long"), () => {}).then(
  () => undefined,
  (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
);
check(tooLong?.includes("larger than") === true, `a body larger than announced stops: ${tooLong}`);

// 3. The good artifacts alone pass.
const accepted = join(scratch, "accepted");
const result = await download(
  resolution(names.filter((name) => !name.startsWith("dep"))),
  accepted,
);
check(result.files === 2 && readdirSync(accepted).length === 2, "the untampered artifacts pass");

server.close();
process.exit(failed ? 1 : 0);
