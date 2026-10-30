/**
 * Codeman's pod images, one per engine, which Codeman picks by the `engine` setting: built from
 * the targets of `docker/pod/Dockerfile` by `.github/workflows/pod-image.yml`, published as
 * `ghcr.io/codenergy-dev/codeman-<engine>`, and referenced by digest (decision 8 of the plan for
 * vLLM on pods). Pin a new digest whenever the Dockerfile or `dist/gateway.js` changes: replace an
 * engine's line with `"ghcr.io/codenergy-dev/codeman-<engine>@sha256:<digest>"` in a commit of its
 * own. An empty one has no image: a run on that engine stops before any pod is created. The
 * `pod-image` input overrides the Ollama image only. See docs/settings/vllm.md#pod-images.
 */
export const POD_IMAGES: Readonly<Record<string, string>> = {
  // Published from ce1fed1.
  ollama:
    "ghcr.io/codenergy-dev/codeman-ollama@sha256:111bab4dcb0c1d50f10dfead430325980066df0f756dfe017ce8c2f91821c83f",
  // Published from ce1fed1: vLLM 0.31.0.
  vllm: "ghcr.io/codenergy-dev/codeman-vllm@sha256:95e007062c15d5d7b8a73900e063efb9c9207316dd4c7fedb12a4a967eac2d6f",
};

/**
 * Pod images whose gateway cannot serve on Salad: from before it listened on IPv6, which Salad's
 * Container Gateway reaches pods on, and ended a pod by exiting, since Salad gives a pod no key to
 * delete itself (step 2 of the plan for Salad pods). A `salad-pod` run refuses them before
 * creating a group. Every image pinned before 4c376d5 is one: when new digests are pinned in
 * `POD_IMAGES`, the ones they replace stay here, and the new ones are not added.
 */
export const IMAGES_BEFORE_SALAD: ReadonlySet<string> = new Set([
  "ghcr.io/codenergy-dev/codeman-pod@sha256:6a7617fc8772c43600349a971a424bc918982c6d38972e7d1802a1a607e76d27",
  "ghcr.io/codenergy-dev/codeman-pod@sha256:3252d41775a230249490b5af79aec050151e49c4722bb62f9ce3d247d02f6ca3",
  "ghcr.io/codenergy-dev/codeman-ollama@sha256:1be16bba4040cbdc9f68276cb98dbc41707c4c38d4e16cf7a490003aa79ca08c",
  "ghcr.io/codenergy-dev/codeman-ollama@sha256:dd48e69dd1d29a4651cd52bcd820a6127bc5285898a82e67dfbe830d31d896cb",
  "ghcr.io/codenergy-dev/codeman-ollama@sha256:f5f89da1e8042fadb70edb7d2be44dee5cfc16f022f5da0330da020ca6b304e9",
  "ghcr.io/codenergy-dev/codeman-ollama@sha256:98c454e3577a05230b873276f6b7c1d1da1309db9e04411565509f2a46dfae89",
  "ghcr.io/codenergy-dev/codeman-vllm@sha256:061cb8b15e456b92239b65cdc7abc0706cbfe3219a2abbcb15c2a82edcba82a0",
  "ghcr.io/codenergy-dev/codeman-vllm@sha256:2ffa65329f98ac14f184ea46f596b5d10ff89024914ef7c885e65796e30aa434",
  "ghcr.io/codenergy-dev/codeman-vllm@sha256:73f6419404c8c419cb8381c3cb593db0325aa6d813beb7f2a31b52923d8a0d30",
  "ghcr.io/codenergy-dev/codeman-vllm@sha256:a5b4a03205fc96f1ae3a731a03124a5a27eaf2d36450f937ff1f063112fc681e",
]);

/**
 * A release that a pod runs, as the release policy checks it: its version and publication date
 * (the minimum age), its package on OSV.dev (advisories), the release it replaces (the security
 * fix bypass) and what its publisher offers to trace it to its source (recorded, not required).
 * The release policy module defines the same interface; a later step keeps only one.
 */
export interface ReleaseArtifact {
  name: string;
  version: string;
  /** ISO 8601. */
  publishedAt: string;
  osv?: { ecosystem: string; package: string };
  /** The version this release replaces in the catalog, when it replaced one. */
  replaces?: string;
  provenance?: Record<string, string | boolean>;
}

/** An advisory accepted for a pinned release, by its OSV.dev ID, with why. */
export interface AdvisoryException {
  id: string;
  reason: string;
}

/** An engine's official image, pinned by its index digest, with its engine's release. */
export interface EngineRelease {
  /** `docker.io/<repository>@sha256:<index digest>`. */
  image: string;
  release: ReleaseArtifact;
  exceptions: readonly AdvisoryException[];
}

/** Node's linux-x64 tarball, which the bootstrap downloads into a pod and checks. */
export interface NodeRelease {
  url: string;
  /** The tarball's SHA-256, in hex. */
  sha256: string;
  release: ReleaseArtifact;
}

/** Why Ollama's advisories about uploading or creating a model do not reach a pod's Ollama. */
const NO_MODEL_UPLOAD =
  "Its API listens only on the pod's loopback, and the gateway forwards only `/v1/chat/completions`, `/v1/completions` and `/v1/models` to it, so no request creates a model or uploads a blob; the gateway pulls only the settings' model, from Ollama's registry.";

/**
 * What pods run once they start from the engines' official images (the plan to start pods from
 * official engine images, step 3): each engine's image by index digest, with its release, and Node
 * for the bootstrap. Pinned and audited by hand (docs/development/dependencies.md#audit-log): the
 * release policy checks them again on every pod `open-key` creates, and an advisory it finds
 * blocks unless an exception below accepts it. Exceptions live here, reviewed in the commit that
 * pins (decision 2), and name the IDs OSV.dev returns for the release. `POD_IMAGES` stays what pods
 * run until a later step switches its consumers to this catalog.
 */
export const ENGINE_RELEASES: Readonly<Record<string, EngineRelease>> = {
  // Ollama 0.35.1, kept: no release after it fixes any of its 9 advisories (OSV.dev and GitHub's
  // advisory database, 2026-10-30, up to 0.40.13). Go's records have no upper bound and no
  // severity; GitHub's, their aliases, bound each at or below 0.20.2. docs/web/osv/ollama-*.md.
  ollama: {
    image:
      "docker.io/ollama/ollama@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c",
    release: {
      name: "ollama",
      version: "0.35.1",
      // The image's `created`; the GitHub release is of 2026-09-29T20:14:22Z.
      publishedAt: "2026-10-02T16:56:02Z",
      osv: { ecosystem: "Go", package: "github.com/ollama/ollama" },
      provenance: {
        source: "https://github.com/ollama/ollama",
        commit: "b0c1ca4f7549d7acdfa52a7dcffc934bc63a43ce",
        githubReleasePublishedAt: "2026-09-29T20:14:22Z",
        githubReleaseImmutable: false,
        tag: "lightweight",
        commitVerified: true,
        attestations: false,
        imageSignature: false,
        imageRevisionLabel: false,
      },
    },
    exceptions: [
      {
        id: "GO-2025-3557",
        reason: `CVE-2025-0315 (GHSA-fccc-8m69-8r78, high, up to 0.3.14): a crafted GGUF model uploaded and created exhausts memory. ${NO_MODEL_UPLOAD}`,
      },
      {
        id: "GO-2025-3558",
        reason: `CVE-2024-12055 (GHSA-89qx-m49c-8crf, high, up to 0.3.14): a crafted GGUF model uploaded and created crashes the server. ${NO_MODEL_UPLOAD}`,
      },
      {
        id: "GO-2025-3559",
        reason: `CVE-2025-0317 (GHSA-9gcr-28rp-cc24, high, up to 0.3.14): a crafted GGUF model uploaded and created divides by zero. ${NO_MODEL_UPLOAD}`,
      },
      {
        id: "GO-2025-3582",
        reason: `CVE-2025-0312 (GHSA-p2wh-w96x-w232, high, up to 0.3.14): a crafted GGUF model uploaded and created dereferences a null pointer. ${NO_MODEL_UPLOAD}`,
      },
      {
        id: "GO-2025-3689",
        reason: `CVE-2024-8063 (GHSA-2xf2-gjm6-g2c6, high, up to 0.3.3): a GGUF model imported through a crafted Modelfile divides by zero. ${NO_MODEL_UPLOAD}`,
      },
      {
        id: "GO-2025-3695",
        reason:
          "CVE-2025-1975 (GHSA-wrh5-cmwx-q2qr, high, up to 0.5.11): a crafted manifest from a spoofed registry crashes `/api/pull`. Only the gateway calls `/api/pull`, for the settings' model on Ollama's registry over TLS; at worst the pod's start fails.",
      },
      {
        id: "GO-2025-3824",
        reason:
          "CVE-2025-51471 (GHSA-x9hg-5q6g-q3jr, moderate, up to 0.9.6): a malicious registry's `WWW-Authenticate` realm takes the token `/api/pull` signs. Only the gateway pulls, from Ollama's registry, and the pod's Ollama holds no account: its key is generated in the pod and reaches nothing else.",
      },
      {
        id: "GO-2025-4251",
        reason:
          "CVE-2025-63389 (GHSA-f6mr-38g8-39rg, critical, up to 0.13.5): the API has no authentication. Accepted by design: the gateway sets `OLLAMA_HOST=127.0.0.1:11434`, so only the pod's own processes reach it, and the gateway forwards only three OpenAI-compatible routes, for the runs' tokens.",
      },
      {
        id: "GO-2026-5750",
        reason:
          "CVE-2026-7020 (GHSA-x99g-8v8j-25j2, low, up to 0.20.2): path traversal in the image generation models' transfer (`x/imagegen/transfer`). It runs only when pulling or creating a model, which only the gateway does, for the settings' model on Ollama's registry.",
      },
    ],
  },
  // vLLM 0.32.0, replacing 0.31.0, whose 2 high advisories (GHSA-6757-hggm-hp2w,
  // GHSA-h3rc-j82p-2c3h) it fixes; no advisory for it on OSV.dev or GitHub on 2026-10-30. CUDA
  // 13.0, as 0.31.0 (`VLLM_MIN_CUDA`). docs/web/docker-hub/vllm-vllm-openai-v0-32-0.md.
  vllm: {
    image:
      "docker.io/vllm/vllm-openai@sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34",
    release: {
      name: "vllm",
      version: "0.32.0",
      // The image's `created`; the GitHub release is of 06:50:48Z, the first wheel on PyPI 10:03:29Z.
      publishedAt: "2026-10-18T03:08:50Z",
      osv: { ecosystem: "PyPI", package: "vllm" },
      replaces: "0.31.0",
      provenance: {
        source: "https://github.com/vllm-project/vllm",
        commit: "5df63a7203cdb9328d824a27b682e77c7b9928be",
        imageRevisionLabel: true,
        revisionMatchesTag: true,
        commitVerified: false,
        githubReleasePublishedAt: "2026-10-18T06:50:48Z",
        githubReleaseImmutable: false,
        pypiPublishedAt: "2026-10-18T10:03:29Z",
        attestations: false,
        imageSignature: false,
      },
    },
    exceptions: [],
  },
};

/**
 * Node for the bootstrap: the first 24.x release without the compromised `emSign ECC Root CA -
 * G3` (decision 9; docs/web/nodejs/node-v24-22-1.md). Its SHA-256 is the line of
 * `SHASUMS256.txt`, whose detached signature verified with the releaser's key from
 * nodejs/release-keys (docs/development/dependencies.md#audit-log). OSV.dev covers no Node.js
 * release: its advisories are checked by hand, from its security releases, when it is pinned.
 */
export const NODE_RELEASE: NodeRelease = {
  url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz",
  sha256: "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
  release: {
    name: "node",
    version: "24.22.1",
    publishedAt: "2026-10-21T10:38:25Z",
    replaces: "24.21.0",
    provenance: {
      source: "https://github.com/nodejs/node",
      commit: "ce7aaf1cee78b8cf0ce17364260535c418d3ed26",
      shasumsSigned: true,
      signingKey: "5BE8A3F6C8A5C01D106C0AD820B1A390B168D356",
    },
  },
};

/** The image of an engine's pods: the `pod-image` input's for Ollama, else the pinned one. */
export function podImage(engine: string, override = ""): string {
  if (engine === "ollama" && override !== "") return override;
  return POD_IMAGES[engine] ?? "";
}
