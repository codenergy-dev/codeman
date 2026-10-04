import type { InferenceEngine } from "./engine.ts";
import { ollama } from "./ollama.ts";
import { vllm } from "./vllm.ts";

/** The engines self-hosted inference can use, by the name the `engine` setting gives. */
export const ENGINES: Readonly<Record<string, InferenceEngine>> = { ollama, vllm };

/** The engine each kind of GPU rental serves models with (decision 9 of the plan). */
export const MODE_ENGINE = { pod: "ollama", serverless: "vllm" } as const;
