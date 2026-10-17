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
  // Published from e26a8c9.
  ollama:
    "ghcr.io/codenergy-dev/codeman-ollama@sha256:1be16bba4040cbdc9f68276cb98dbc41707c4c38d4e16cf7a490003aa79ca08c",
  // Published from e26a8c9: vLLM 0.31.0.
  vllm: "ghcr.io/codenergy-dev/codeman-vllm@sha256:2ffa65329f98ac14f184ea46f596b5d10ff89024914ef7c885e65796e30aa434",
};

/** The image of an engine's pods: the `pod-image` input's for Ollama, else the pinned one. */
export function podImage(engine: string, override = ""): string {
  if (engine === "ollama" && override !== "") return override;
  return POD_IMAGES[engine] ?? "";
}
