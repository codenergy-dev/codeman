/**
 * An inference engine: what serves a model behind Codeman's gateway, on a pod (Ollama) or a
 * Serverless worker (vLLM). See docs/architecture.md#self-hosted-inference.
 */
export interface InferenceEngine {
  readonly name: string;
  /** Whether `model` is a model name of this engine. */
  isModel(model: string): boolean;
  /** A model name, for messages. */
  readonly example: string;
  /** What an OpenAI-compatible response, or a stream's last chunk, says it used. */
  usage(body: unknown): EngineUsage | undefined;
}

/** Tokens of one request, as the engine counts them. */
export interface EngineUsage {
  /** Prompt tokens, cached ones included. */
  input: number;
  output: number;
}

/**
 * `usage` in OpenAI's format: `prompt_tokens` and `completion_tokens`. Engines that leave cached
 * tokens out of `prompt_tokens` report them in `prompt_tokens_details.cached_tokens`, and
 * `cachedApart` adds them back.
 */
export function openAiUsage(body: unknown, cachedApart = false): EngineUsage | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const usage = (body as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const fields = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
  };
  const input = count(fields.prompt_tokens);
  const output = count(fields.completion_tokens);
  if (input === undefined || output === undefined) return undefined;
  const cached = cachedApart ? (count(fields.prompt_tokens_details?.cached_tokens) ?? 0) : 0;
  return { input: input + cached, output };
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
