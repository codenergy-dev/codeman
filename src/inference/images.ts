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
  // Published from 5e733d1, before the image per engine; it predates Ollama settings.
  ollama:
    "ghcr.io/codenergy-dev/codeman-pod@sha256:3252d41775a230249490b5af79aec050151e49c4722bb62f9ce3d247d02f6ca3",
  // Not published yet.
  vllm: "",
};

/** The image of an engine's pods: the `pod-image` input's for Ollama, else the pinned one. */
export function podImage(engine: string, override = ""): string {
  if (engine === "ollama" && override !== "") return override;
  return POD_IMAGES[engine] ?? "";
}
