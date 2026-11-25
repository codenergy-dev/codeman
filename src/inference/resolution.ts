import type { GatewayArtifact } from "../action.ts";
import type { BootstrapArtifacts } from "../gateway/bootstrap.ts";
import type { Log } from "../runtime/runtime.ts";
import { LAYOUT } from "../store/layout.ts";
import type { Fields, Store } from "../store/store.ts";
import {
  catalogRelease,
  ENGINE_RELEASES,
  type EngineRelease,
  NODE_RELEASE,
  type NodeRelease,
} from "./images.ts";
import type { AdvisoryDatabase } from "./osv.ts";
import {
  type ArtifactCheck,
  checkReleases,
  type ReleaseArtifact,
  type ReleaseCheck,
  type ReleaseCheckCache,
} from "./release-policy.ts";

/**
 * What `open-key` resolves and checks before it claims or creates a pod (step 7 of the plan to
 * start pods from official engine images): the gateway, the catalog's releases, OSV.dev's
 * advisories, and the backend's cache of passing checks.
 */
export interface PodReleases {
  /** The gateway a pod downloads; throws when it cannot be given, as without a known commit. */
  gateway: () => GatewayArtifact;
  /** Where the releases' advisories are read: OSV.dev. */
  osv: AdvisoryDatabase;
  /** Where passing checks stand in for OSV.dev when it does not answer (decision 7). */
  cache: ReleaseCheckCache;
  /** The catalog: `ENGINE_RELEASES` and `NODE_RELEASE` (src/inference/images.ts) by default. */
  engines?: Readonly<Record<string, EngineRelease>> | undefined;
  node?: NodeRelease | undefined;
}

/** What a pod of these settings runs, and the release policy's verdict on it. */
export interface Resolution {
  /** What the pod's bootstrap downloads. */
  artifacts: BootstrapArtifacts;
  check: ReleaseCheck;
  /** The pod document's `resolution` field (decision 6). */
  fields: Fields;
}

/**
 * The release policy blocked a pod's releases, or could not check them: a mistake in the pinned
 * releases, or OSV.dev's outage, never a lack of room, so the run stops and falls back to no other
 * profile.
 */
export class ReleaseBlocked extends Error {
  readonly check: ReleaseCheck;

  constructor(message: string, check: ReleaseCheck) {
    super(message);
    this.check = check;
  }
}

/**
 * Resolves what a pod of `engine` on `image` runs, and checks it against the release policy: the
 * engine's release, when the image is the catalog's, and Node.js's, with the engine's exceptions.
 * Logs the verdict and its reasons. Throws a `ReleaseBlocked` when it blocks, and the gateway's
 * error when its commit is unknown.
 */
export async function resolvePod(
  engine: string,
  image: string,
  releases: PodReleases,
  now: Date,
  log: Log,
): Promise<Resolution> {
  const gateway = releases.gateway();
  const node = releases.node ?? NODE_RELEASE;
  const pinned = catalogRelease(engine, image, releases.engines ?? ENGINE_RELEASES);
  if (!pinned) {
    log.info(
      `The pod image ${image} is not the one Codeman pins for ${engine}, as when the \`pod-image\` input chooses it: the release policy checks Node.js only.`,
    );
  }
  const artifacts: ReleaseArtifact[] = [...(pinned ? [pinned.release] : []), node.release];
  // Whether OSV.dev failed to answer, which a block then comes from.
  let unreadable = false;
  const failed = (error: unknown): never => {
    unreadable = true;
    throw error;
  };
  const osv: AdvisoryDatabase = {
    query: (queries) => releases.osv.query(queries).catch(failed),
    records: (ids) => releases.osv.records(ids).catch(failed),
  };
  const check = await checkReleases(artifacts, {
    now,
    exceptions: pinned?.exceptions ?? [],
    osv,
    cache: releases.cache,
  });
  const names = artifacts.map((artifact) => `${artifact.name} ${artifact.version}`).join(" and ");
  if (check.verdict === "block") {
    const reasons = check.reasons.filter((reason) => reason.level === "block");
    for (const reason of reasons) log.error(`Release policy: ${reason.text}`);
    const text = reasons.map((reason) => reason.text).join(" ");
    throw new ReleaseBlocked(
      unreadable
        ? `The release policy could not check ${names}, so no pod was created and the run stops: ${text}`
        : `The release policy blocks ${names}, so no pod was created, and the run stops rather than fall back to another profile: ${text} Codeman pins these releases (\`ENGINE_RELEASES\` and \`NODE_RELEASE\` in src/inference/images.ts): set CODEMAN_COMMIT_SHA to a commit of Codeman whose releases pass, or, for Ollama, choose an image with the \`pod-image\` input, which the policy does not check.`,
      check,
    );
  }
  const from = check.source === "cache" ? `, from its check at ${check.cachedFrom}` : "";
  const verdict = check.verdict === "warn" ? "passes, with warnings," : "passes";
  log.info(`The release policy ${verdict} ${names}${from}.`);
  for (const reason of check.reasons) {
    if (reason.level === "warning") log.warning(`Release policy: ${reason.text}`);
    else log.info(`Release policy: ${reason.text}`);
  }
  const bootstrap: BootstrapArtifacts = {
    node: { url: node.url, sha256: node.sha256 },
    gateway: { url: gateway.url, sha256: gateway.sha256 },
  };
  const found = (name: string) => check.artifacts.find((one) => one.name === name);
  return {
    artifacts: bootstrap,
    check,
    fields: resolutionFields(check, {
      image: { reference: image, ...(pinned ? { check: found(pinned.release.name) } : {}) },
      node: { url: node.url, sha256: node.sha256, check: found(node.release.name) },
      gateway,
    }),
  };
}

/**
 * The pod document's `resolution` (decision 6): each artifact's URL and digest, the policy's
 * checks of the image's and Node.js's releases (age, advisories, exceptions used, provenance),
 * and the verdict. Stored as plain values: no field is undefined.
 */
function resolutionFields(
  check: ReleaseCheck,
  artifacts: {
    image: { reference: string; check?: ArtifactCheck | undefined };
    node: { url: string; sha256: string; check: ArtifactCheck | undefined };
    gateway: GatewayArtifact;
  },
): Fields {
  const { image, node, gateway } = artifacts;
  const digest = /@(sha256:[0-9a-f]{64})$/.exec(image.reference)?.[1];
  const plain = JSON.parse(
    JSON.stringify({
      verdict: check.verdict,
      source: check.source,
      ...(check.cachedFrom ? { cachedFrom: check.cachedFrom } : {}),
      image: {
        reference: image.reference,
        ...(digest ? { digest } : {}),
        // An image the `pod-image` input chose is not checked.
        checked: image.check !== undefined,
        ...(image.check ? released(image.check) : {}),
      },
      node: {
        url: node.url,
        sha256: node.sha256,
        ...(node.check ? released(node.check) : {}),
      },
      gateway: { url: gateway.url, sha256: gateway.sha256, commit: gateway.commit },
      reasons: check.reasons,
    }),
  ) as Fields;
  return { ...plain, checkedAt: new Date(check.checkedAt) };
}

/** What the policy found of one release. */
function released(check: ArtifactCheck) {
  return {
    name: check.name,
    version: check.version,
    publishedAt: check.publishedAt,
    ageDays: check.ageDays,
    verdict: check.verdict,
    advisories: check.advisories,
    exceptions: check.exceptions,
    ...(check.bypass ? { bypass: check.bypass } : {}),
    ...(check.provenance ? { provenance: check.provenance } : {}),
  };
}

/**
 * The backend's passing checks, by `releaseCheckKey` (`releaseChecks/{key}`): the result as JSON
 * text, as the policy wrote it, beside its verdict, the releases and when it was checked, for
 * people reading it. The policy reads one only within 24 hours of its check.
 */
export class StoredReleaseChecks implements ReleaseCheckCache {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  async get(key: string): Promise<ReleaseCheck | undefined> {
    const result = (await this.#store.get(LAYOUT.releaseCheck(key)))?.fields.result;
    return typeof result === "string" ? (JSON.parse(result) as ReleaseCheck) : undefined;
  }

  async set(key: string, result: ReleaseCheck): Promise<void> {
    await this.#store.write([
      {
        op: "set",
        path: LAYOUT.releaseCheck(key),
        fields: {
          releases: result.artifacts.map((artifact) => `${artifact.name} ${artifact.version}`),
          verdict: result.verdict,
          checkedAt: new Date(result.checkedAt),
          result: JSON.stringify(result),
        },
      },
    ]);
  }
}
