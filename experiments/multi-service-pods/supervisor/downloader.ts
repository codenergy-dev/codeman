/**
 * The in-pod downloader (E4 of docs/plans/2026-10-30-investigate-multi-service-pods.md): reads a
 * resolution, downloads each artifact while hashing its stream, and writes it into the
 * destination only once every artifact's SHA-256 and size match. Any mismatch refuses the whole
 * install: nothing reaches the destination. Node's built-ins only.
 *
 * Usage: node downloader.ts <resolution.json> <destination directory>
 *   The destination must not exist. Exits 1 on any mismatch or failure.
 *
 * A resolution: {"engine", "format", "artifacts": [{"name", "version", "url", "sha256", "size",
 * "path"?}]}; `path`, relative, places the file in a subdirectory (a model's files); the default
 * is the URL's last segment, decoded. Only https URLs, or http on the loopback, are taken.
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

export interface Artifact {
  name: string;
  version?: string;
  url: string;
  sha256: string;
  size?: number;
  path?: string;
}

export interface Resolution {
  engine: string;
  format: string;
  artifacts: Artifact[];
}

export interface Downloaded {
  files: number;
  bytes: number;
  seconds: number;
}

/** Downloads at once; each is a stream to disk, so memory stays small. */
const PARALLEL = 4;

/** Reads and checks a resolution's shape: every field the downloader relies on. */
export function readResolution(file: string): Resolution {
  const resolution = JSON.parse(readFileSync(file, "utf8")) as Resolution;
  if (!Array.isArray(resolution.artifacts) || resolution.artifacts.length === 0) {
    throw new Error(`${file} has no artifacts.`);
  }
  const paths = new Set<string>();
  for (const artifact of resolution.artifacts) {
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) {
      throw new Error(`${artifact.name} has no SHA-256.`);
    }
    const url = new URL(artifact.url);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error(`${artifact.name}: only https URLs are taken, not ${url.protocol}.`);
    }
    const path = target(artifact);
    if (paths.has(path)) throw new Error(`Two artifacts write ${path}.`);
    paths.add(path);
  }
  return resolution;
}

/** Where an artifact goes, relative to the destination; never outside it. */
function target(artifact: Artifact): string {
  const path = normalize(
    artifact.path ?? decodeURIComponent(new URL(artifact.url).pathname.split("/").pop() ?? ""),
  );
  if (path === "" || path === "." || path.startsWith("..") || path.startsWith("/")) {
    throw new Error(`${artifact.name} has an unsafe path: ${path}.`);
  }
  return path;
}

/**
 * Downloads every artifact into a staging directory beside the destination, then moves them in
 * once all are verified. On any failure the staging directory is removed and nothing is moved.
 */
export async function download(
  resolution: Resolution,
  destination: string,
  log: (message: string) => void = console.log,
): Promise<Downloaded> {
  const root = resolve(destination);
  if (existsSync(root)) throw new Error(`${root} exists: the destination must be new.`);
  const staging = `${root}.partial-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const started = Date.now();
  let bytes = 0;
  try {
    const pending = [...resolution.artifacts];
    const workers = Array.from({ length: PARALLEL }, async () => {
      for (let artifact = pending.shift(); artifact; artifact = pending.shift()) {
        // Read after the await: `bytes += await ...` would lose the other workers' sums.
        const size = await fetchVerified(artifact, join(staging, target(artifact)));
        bytes += size;
      }
    });
    // Every worker settles before the staging directory goes, whatever failed first.
    const results = await Promise.allSettled(workers);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
    // Every artifact matched: only now does anything reach the destination.
    renameSync(staging, root);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const seconds = (Date.now() - started) / 1000;
  log(
    `Verified ${resolution.artifacts.length} artifacts, ${(bytes / 1e6).toFixed(1)} MB, in ` +
      `${seconds.toFixed(1)} s (${(bytes / 1e6 / seconds).toFixed(1)} MB/s).`,
  );
  return { files: resolution.artifacts.length, bytes, seconds };
}

/** Streams one artifact to `file`, hashing it on the way; fails on any mismatch. */
async function fetchVerified(artifact: Artifact, file: string): Promise<number> {
  const response = await fetch(artifact.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`${artifact.name}: ${artifact.url} answered ${response.status}.`);
  }
  mkdirSync(dirname(file), { recursive: true });
  const hash = createHash("sha256");
  let size = 0;
  const limit = artifact.size && artifact.size > 0 ? artifact.size : Number.POSITIVE_INFINITY;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      // A body larger than announced stops at once, rather than filling the disk.
      if (size > limit) return done(new Error(`${artifact.name} is larger than ${limit} bytes.`));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(file));
  const digest = hash.digest("hex");
  if (digest !== artifact.sha256) {
    throw new Error(
      `${artifact.name}: SHA-256 mismatch, expected ${artifact.sha256}, got ${digest}. ` +
        "The install is refused.",
    );
  }
  if (limit !== Number.POSITIVE_INFINITY && size !== limit) {
    throw new Error(`${artifact.name}: ${size} bytes, expected ${limit}. The install is refused.`);
  }
  return size;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, destination] = process.argv.slice(2);
  if (!file || !destination) {
    console.error("Usage: node downloader.ts <resolution.json> <destination directory>");
    process.exit(2);
  }
  try {
    await download(readResolution(file), destination);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
