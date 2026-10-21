import { POD_IMAGES } from "../../src/inference/images.ts";

/**
 * The local e2e pod image that stands in for each of Codeman's pinned pod images, for the
 * host-side orchestrator (decision 2 of docs/plans/2026-10-20-end-to-end-test-suite.md): the fake
 * Runpod passes it the image a pod was created with, and it runs the local image this allowlist
 * maps it to, or refuses. Codeman asks Runpod for `POD_IMAGES` (src/inference/images.ts) by
 * digest; e2e/infra/compose.yaml's `images` profile builds the local images, from dist/.
 */
export const LOCAL_POD_IMAGES: Readonly<Record<string, string>> = {
  ollama: "codeman-e2e-pod-ollama:local",
  vllm: "codeman-e2e-pod-vllm:local",
};

/** Each pinned image, by its full reference with the digest, and the local image for it. */
export const POD_IMAGE_ALLOWLIST: ReadonlyMap<string, string> = new Map(
  Object.entries(POD_IMAGES).flatMap(([engine, image]) => {
    const local = LOCAL_POD_IMAGES[engine];
    return image && local ? [[image, local] as const] : [];
  }),
);

/**
 * The local image for a pod's image; throws for any other image, such as one the `pod-image`
 * input names, or a pinned image's tag without its digest.
 */
export function localPodImage(image: string): string {
  const local = POD_IMAGE_ALLOWLIST.get(image);
  if (!local) {
    const known = [...POD_IMAGE_ALLOWLIST.keys()].join(", ");
    throw new Error(`No e2e pod image stands in for ${image}; the allowlist has ${known}.`);
  }
  return local;
}
