import type { InferenceEngine } from "./engine.ts";
import { ollama } from "./ollama.ts";
import { vllm } from "./vllm.ts";

/**
 * The engines providers serve models with, by the name the `engine` setting gives; which
 * provider offers which is in `providers.ts`.
 */
export const ENGINES: Readonly<Record<string, InferenceEngine>> = { ollama, vllm };
