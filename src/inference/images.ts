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
  // Published from 4c376d5.
  ollama:
    "ghcr.io/codenergy-dev/codeman-ollama@sha256:80d94429681906e1a3e21c8ccb4e722ee2f1ac4d0a552dedbbff213b93fb2a72",
  // Published from 4c376d5: vLLM 0.31.0.
  vllm: "ghcr.io/codenergy-dev/codeman-vllm@sha256:3475904197578a12c30e61ae59041cb0cb0898cec0482e85368a214963f306b7",
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

/** The image of an engine's pods: the `pod-image` input's for Ollama, else the pinned one. */
export function podImage(engine: string, override = ""): string {
  if (engine === "ollama" && override !== "") return override;
  return POD_IMAGES[engine] ?? "";
}
