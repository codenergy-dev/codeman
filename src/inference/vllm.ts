import { type InferenceEngine, openAiUsage } from "./engine.ts";

/** Hugging Face IDs, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`, or a served name without `/`. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/**
 * vLLM, as Runpod's Serverless worker runs it: configured by the endpoint's environment. See
 * docs/web/runpod/vllm-environment-variables.md.
 */
export const vllm: InferenceEngine = {
  name: "vllm",
  example: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  isModel: (model) => model.length <= 100 && MODEL.test(model),
  usage: (body) => openAiUsage(body),
};

/** The names the worker answers to: its served name, if overridden, and its model. */
export function servedModels(env: Record<string, string>): string[] {
  return [env.OPENAI_SERVED_MODEL_NAME_OVERRIDE, env.MODEL_NAME].filter(
    (name): name is string => typeof name === "string" && name !== "",
  );
}

/** Why the worker cannot serve `model` to a coding agent; empty when it can. */
export function vllmProblems(env: Record<string, string>, model: string): string[] {
  const problems: string[] = [];
  const served = servedModels(env);
  if (!served.includes(model)) {
    problems.push(
      `it serves ${served.length > 0 ? served.map((name) => `\`${name}\``).join(" or ") : "no model"}, not \`${model}\` (MODEL_NAME or OPENAI_SERVED_MODEL_NAME_OVERRIDE)`,
    );
  }
  // The harness works through tool calls.
  if (env.ENABLE_AUTO_TOOL_CHOICE?.toLowerCase() !== "true" || !env.TOOL_CALL_PARSER) {
    problems.push(
      "it does not call tools: set ENABLE_AUTO_TOOL_CHOICE to true and TOOL_CALL_PARSER",
    );
  }
  return problems;
}

/** The context length the worker allocates for, from `MAX_MODEL_LEN`. */
export function vllmContextLength(env: Record<string, string>): number | undefined {
  const value = Number(env.MAX_MODEL_LEN);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
