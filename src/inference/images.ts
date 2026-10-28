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
  // Published from dfef37e.
  ollama:
    "ghcr.io/codenergy-dev/codeman-ollama@sha256:f5f89da1e8042fadb70edb7d2be44dee5cfc16f022f5da0330da020ca6b304e9",
  // Published from dfef37e: vLLM 0.31.0.
  vllm: "ghcr.io/codenergy-dev/codeman-vllm@sha256:061cb8b15e456b92239b65cdc7abc0706cbfe3219a2abbcb15c2a82edcba82a0",
};

/** The image of an engine's pods: the `pod-image` input's for Ollama, else the pinned one. */
export function podImage(engine: string, override = ""): string {
  if (engine === "ollama" && override !== "") return override;
  return POD_IMAGES[engine] ?? "";
}
