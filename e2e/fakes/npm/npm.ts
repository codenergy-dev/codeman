import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Fetch } from "../../../src/budget.ts";
import {
  downloadOpenCode,
  OPENCODE_PACKAGES,
  OPENCODE_VERSION,
  type OpenCodePackage,
} from "../../../src/harness/opencode.ts";
import { FakeServer, json } from "../http.ts";

/**
 * A local npm registry cache for OpenCode's download (src/harness/opencode.ts), which the e2e
 * build reaches through its `npm` endpoint. It serves only the route Codeman requests, the
 * tarball `/<name>/-/<name>-<version>.tgz` of a pinned package, from a directory that `fill`
 * fills once from the real registry. It serves the bytes as stored: Codeman's own integrity
 * check guards the download, as it does against the real registry.
 */

/** A package the cache serves, by npm name and version. */
export interface CachedPackage {
  name: string;
  version: string;
}

/** The packages Codeman downloads: OpenCode's pinned platform packages. */
export const PINNED: readonly CachedPackage[] = Object.values(OPENCODE_PACKAGES).map((pkg) => ({
  name: pkg.name,
  version: OPENCODE_VERSION,
}));

/** The tarball's file name, in the registry's URL and in the cache directory. */
export function tarballName(pkg: CachedPackage): string {
  return `${pkg.name}-${pkg.version}.tgz`;
}

/** The registry's answer to a package or version it does not have. */
const NOT_FOUND = json({ error: "Not found" }, 404);

export class NpmCache {
  readonly server: FakeServer;
  readonly #dir: string;
  readonly #files: Set<string>;

  constructor(dir: string, packages: readonly CachedPackage[] = PINNED) {
    this.#dir = dir;
    this.#files = new Set(packages.map((pkg) => `${pkg.name}/${tarballName(pkg)}`));
    this.server = new FakeServer("npm");
    this.server.route("GET", "/{name}/-/{file}", async (request, response) => {
      const { name, file } = request.params;
      if (!name || !file || !this.#files.has(`${name}/${file}`)) return NOT_FOUND;
      const path = join(this.#dir, file);
      const size = await stat(path).then(
        (found) => (found.isFile() ? found.size : undefined),
        () => undefined,
      );
      if (size === undefined) {
        return json({ error: `Not found: ${file} is not in the cache; run fill.ts.` }, 404);
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(size),
      });
      await pipeline(createReadStream(path), response);
      return undefined;
    });
  }
}

/** The cache in `FAKE_NPM_CACHE`, a directory `fill.ts` filled. */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  const dir = env.FAKE_NPM_CACHE;
  if (!dir) throw new Error("The npm fake needs FAKE_NPM_CACHE, the cache's directory.");
  return new NpmCache(dir).server;
}

/** The pinned packages of these platforms, such as `linux-x64`; throws for one not pinned. */
export function packagesFor(platforms: readonly string[]): OpenCodePackage[] {
  return platforms.map((platform) => {
    const pkg = OPENCODE_PACKAGES[platform];
    if (!pkg) {
      const known = Object.keys(OPENCODE_PACKAGES).join(", ");
      throw new Error(`No OpenCode package is pinned for ${platform}; pinned: ${known}.`);
    }
    return pkg;
  });
}

/**
 * Stores each package's tarball in `dir`, downloaded with Codeman's own `downloadOpenCode`,
 * which refuses a tarball that does not match the pinned integrity. A file already there with
 * that integrity is kept, so a filled cache downloads nothing. Nothing downloaded is run.
 * Returns the files it downloaded.
 */
export async function fill(
  dir: string,
  packages: readonly OpenCodePackage[],
  fetchFn: Fetch = fetch,
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const downloaded: string[] = [];
  for (const pkg of packages) {
    const file = tarballName({ name: pkg.name, version: OPENCODE_VERSION });
    const path = join(dir, file);
    const present = await readFile(path).catch(() => undefined);
    if (present && integrityOf(present) === pkg.integrity) continue;
    const tarball = await downloadOpenCode(pkg, fetchFn);
    const partial = `${path}.partial`;
    try {
      await writeFile(partial, tarball);
      await rename(partial, path);
    } finally {
      await rm(partial, { force: true });
    }
    downloaded.push(file);
  }
  return downloaded;
}

/** npm's `dist.integrity` of `bytes`, as Codeman computes it. */
export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
