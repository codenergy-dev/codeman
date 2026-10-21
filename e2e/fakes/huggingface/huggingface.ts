import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { FakeServer, HttpError, json } from "../http.ts";

/**
 * A fake of Hugging Face's Hub for the e2e suite, which the e2e build reaches through its
 * `huggingFace` endpoint. It serves only the route Codeman calls (src/inference/huggingface.ts):
 * a model's information, `GET /api/models/{namespace}/{name}`, with each file's size when the
 * query has `blobs=true` (docs/web/hugging-face/src-huggingface-hub-hf-api-py-at-v2-2-0.md).
 * vLLM on an e2e pod reads the same files offline, from the volume.
 *
 * The models come from a Hugging Face cache, such as the `codeman-e2e-hf` volume that
 * `seed-hf` fills, read-only, in the layout of docs/web/hugging-face/understand-caching.md; or,
 * without one, from `models.json`, the pinned model as that cache gives it. Every model it
 * serves is public, not gated and not disabled. A scenario makes the Hub fail with the shared
 * HTTP faults.
 */

/** A file of a model, as the Hub's `siblings` gives it with `blobs=true`. */
export interface HubFile {
  rfilename: string;
  size: number;
  /** A file stored in git: its blob's hash. */
  blobId?: string;
  /** A file stored with Git LFS: its content's SHA-256 and size. */
  lfs?: { sha256: string; size: number };
}

/** A model the fake serves: its commit and files. */
export interface HubRepo {
  sha: string;
  siblings: HubFile[];
}

/** Where the fake finds a model by its ID, `namespace/name`; undefined when it has none. */
export interface ModelSource {
  model(id: string): Promise<HubRepo | undefined>;
}

/** The bundled fixture: the pinned model of the suite, as the seeded cache gives it. */
export const FIXTURE = new URL("./models.json", import.meta.url);

/**
 * The Hub's answer to an anonymous call for a model it does not have, or that is private, as it
 * answered on 2026-10-21: a 401, which Codeman reads as no public model.
 */
function notFound(): HttpError {
  const message = "Invalid username or password.";
  return new HttpError(401, { error: message }, { "x-error-message": message });
}

export class HuggingFaceFake {
  readonly server = new FakeServer("huggingface");
  readonly #source: ModelSource;

  constructor(source: ModelSource) {
    this.#source = source;
    this.server.route("GET", "/api/models/{namespace}/{name}", async (request) => {
      const id = `${request.params.namespace}/${request.params.name}`;
      const repo = await this.#source.model(id);
      if (!repo) throw notFound();
      const blobs = request.query.get("blobs") === "true";
      return json({
        id,
        sha: repo.sha,
        private: false,
        gated: false,
        disabled: false,
        siblings: repo.siblings.map((file) => (blobs ? file : { rfilename: file.rfilename })),
        // The Hub counts the repository's whole storage; the fake, the files at this commit.
        usedStorage: repo.siblings.reduce((total, file) => total + file.size, 0),
      });
    });
  }
}

/** Models from JSON, by ID: `{ "<namespace>/<name>": { sha, siblings } }`. */
export function fixtureModels(models: Readonly<Record<string, HubRepo>>): ModelSource {
  return { model: async (id) => (Object.hasOwn(models, id) ? models[id] : undefined) };
}

const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;

/**
 * Models from a Hugging Face cache directory (`<HF_HOME>/hub`): `models--<namespace>--<name>`,
 * at the commit `refs/main` names, else at its only snapshot. Each file of the snapshot is a link
 * to its blob, named after its hash: a SHA-256 for a file in Git LFS, a git blob's hash
 * otherwise. Read at each request, so a seed that ends later is seen.
 */
export function cacheModels(dir: string): ModelSource {
  return {
    async model(id) {
      const [namespace, name, ...rest] = id.split("/");
      if (!namespace || !name || rest.length > 0) return undefined;
      const repo = join(dir, `models--${namespace}--${name}`);
      const snapshots = await readdir(join(repo, "snapshots")).catch(() => undefined);
      if (!snapshots) return undefined;
      const main = (await readFile(join(repo, "refs", "main"), "utf8").catch(() => "")).trim();
      const sha = main || (snapshots.length === 1 ? snapshots[0] : undefined);
      if (!sha || !snapshots.includes(sha)) {
        throw new HttpError(500, {
          error: `The cache holds ${id} at ${snapshots.length} commits and no refs/main names one: the fake cannot tell which to serve.`,
        });
      }
      const siblings = await filesOf(join(repo, "snapshots", sha), "");
      return { sha, siblings: siblings.sort((a, b) => a.rfilename.localeCompare(b.rfilename)) };
    },
  };
}

async function filesOf(root: string, prefix: string): Promise<HubFile[]> {
  const files: HubFile[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rfilename = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(root, rfilename);
    if (entry.isDirectory()) {
      files.push(...(await filesOf(root, rfilename)));
      continue;
    }
    // A link's target may be a link too (a blob shared across repositories): stat follows both.
    const found = await stat(path).catch(() => undefined);
    if (!found?.isFile()) continue;
    const hash = (await lstat(path)).isSymbolicLink() ? basename(await readlink(path)) : "";
    files.push({
      rfilename,
      size: found.size,
      ...(SHA1.test(hash) ? { blobId: hash } : {}),
      ...(SHA256.test(hash) ? { lfs: { sha256: hash, size: found.size } } : {}),
    });
  }
  return files;
}

/**
 * The fake for e2e/fakes/main.ts: the cache in `FAKE_HUGGINGFACE_CACHE`, such as the volume's
 * `hub/` directory; the bundled fixture when it is unset.
 */
export async function fromEnv(env: NodeJS.ProcessEnv): Promise<FakeServer> {
  const dir = env.FAKE_HUGGINGFACE_CACHE;
  const source = dir
    ? cacheModels(dir)
    : fixtureModels(JSON.parse(await readFile(FIXTURE, "utf8")) as Record<string, HubRepo>);
  return new HuggingFaceFake(source).server;
}
