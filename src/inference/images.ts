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
  // Published from 6b861d6.
  ollama:
    "ghcr.io/codenergy-dev/codeman-ollama@sha256:dd48e69dd1d29a4651cd52bcd820a6127bc5285898a82e67dfbe830d31d896cb",
  // Published from 6b861d6: vLLM 0.31.0.
  vllm: "ghcr.io/codenergy-dev/codeman-vllm@sha256:73f6419404c8c419cb8381c3cb593db0325aa6d813beb7f2a31b52923d8a0d30",
};

/** The image of an engine's pods: the `pod-image` input's for Ollama, else the pinned one. */
export function podImage(engine: string, override = ""): string {
  if (engine === "ollama" && override !== "") return override;
  return POD_IMAGES[engine] ?? "";
}
