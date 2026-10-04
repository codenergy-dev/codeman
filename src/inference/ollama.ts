import { type InferenceEngine, openAiUsage } from "./engine.ts";

/**
 * Codeman's pod image: Ollama, Node and the gateway, built by `.github/workflows/pod-image.yml`
 * from `docker/pod/Dockerfile` and referenced by digest. Empty until a build is published and
 * pinned here; the `pod-image` input overrides it. See docs/installation.md.
 */
export const POD_IMAGE = "";

/** Where Ollama listens inside the pod: its loopback, behind the gateway. */
export const OLLAMA_URL = "http://127.0.0.1:11434";

/** Ollama model names: `name[:tag]`, optionally after a namespace or registry, such as `qwen3-coder:30b`. */
const MODEL = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,2}(:[a-z0-9][a-z0-9._-]*)?$/i;

/**
 * Ollama, on a pod. Its OpenAI-compatible API reports `usage`, in streams too when asked (see
 * docs/web/ollama/openai-compatibility.md). Whether its `prompt_tokens` counts the prompt it
 * reused from its cache is checked in step 8 of the self-hosted inference plan.
 */
export const ollama: InferenceEngine = {
  name: "ollama",
  example: "qwen3-coder:30b",
  isModel: (model) => model.length <= 100 && MODEL.test(model),
  usage: (body) => openAiUsage(body),
};

/**
 * The model's own context length, from `POST /api/show`: the `<architecture>.context_length` of
 * its `model_info`. See docs/web/ollama/show-model-details.md.
 */
export function ollamaContextLength(show: unknown): number | undefined {
  const info = (show as { model_info?: Record<string, unknown> } | null)?.model_info;
  if (typeof info !== "object" || info === null) return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number" && value > 0) return value;
  }
  return undefined;
}
