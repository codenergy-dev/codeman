import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Fetch } from "../../../src/budget.ts";
import { NODE_RELEASE, type NodeRelease } from "../../../src/inference/images.ts";
import { FakeServer, json } from "../http.ts";

/**
 * nodejs.org's download server, for the bootstrap of the e2e pods (src/gateway/bootstrap.ts): it
 * serves the one file a pod downloads, `NODE_RELEASE`'s tarball, at its path under `/dist/`, from
 * a directory that `fill` fills once from nodejs.org. The pods reach it as `https://nodejs.org`,
 * the jobs network's alias for it, with a certificate of the session's test CA. It serves the bytes
 * as stored: the bootstrap's own SHA-256 check guards the download, as it does against nodejs.org.
 */

/** The answer of nodejs.org's server to a file it does not have. */
const NOT_FOUND = { status: 404, body: "Not Found\n" };

export class NodeDist {
  readonly server: FakeServer;

  constructor(dir: string, release: NodeRelease = NODE_RELEASE) {
    const path = new URL(release.url).pathname;
    const file = basename(path);
    this.server = new FakeServer("nodejs");
    this.server.route("GET", "/dist/{version}/{file}", async (request, response) => {
      if (request.path !== path) return NOT_FOUND;
      const size = await stat(join(dir, file)).then(
        (found) => (found.isFile() ? found.size : undefined),
        () => undefined,
      );
      if (size === undefined) {
        return json({ error: `Not found: ${file} is not in the cache; run fill.ts.` }, 404);
      }
      response.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(size),
      });
      await pipeline(createReadStream(join(dir, file)), response);
      return undefined;
    });
  }
}

/** The cache in `FAKE_NODEJS_CACHE`, a directory `fill.ts` filled. */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  const dir = env.FAKE_NODEJS_CACHE;
  if (!dir) throw new Error("The nodejs fake needs FAKE_NODEJS_CACHE, the cache's directory.");
  return new NodeDist(dir).server;
}

/**
 * Stores `release`'s tarball in `dir`, downloaded from its URL, only when its SHA-256 is the
 * pinned one. A file already there with that SHA-256 is kept, so a filled cache downloads
 * nothing. Nothing downloaded is run. Returns whether it downloaded.
 */
export async function fill(
  dir: string,
  release: NodeRelease = NODE_RELEASE,
  fetchFn: Fetch = fetch,
): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, basename(new URL(release.url).pathname));
  const present = await readFile(path).catch(() => undefined);
  if (present && sha256(present) === release.sha256) return false;
  const response = await fetchFn(release.url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`${release.url} answered ${response.status}.`);
  const tarball = Buffer.from(await response.arrayBuffer());
  const actual = sha256(tarball);
  if (actual !== release.sha256) {
    throw new Error(`Refused ${release.url}: its SHA-256 is ${actual}, not ${release.sha256}.`);
  }
  const partial = `${path}.partial`;
  try {
    await writeFile(partial, tarball);
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return true;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
