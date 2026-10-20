import type { ServerResponse } from "node:http";

/**
 * The model side of the fake OpenRouter's `POST /api/v1/chat/completions`: what a `Completions`
 * answers, and how the fake turns it into OpenRouter's JSON or SSE. Shapes follow
 * docs/web/openrouter/create-a-chat-completion.md and streaming.md.
 */

/** The request's body; fields other than these pass through untouched. */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  tools?: unknown[];
  max_tokens?: number;
  [field: string]: unknown;
}

export interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  [field: string]: unknown;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A tool call's part in a stream: the first part of an `index` has its id and name. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface ChatDelta {
  role?: "assistant";
  content?: string;
  reasoning?: string;
  tool_calls?: ToolCallDelta[];
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "error";

/** The tokens a reply used; the fake prices them to bill the key. */
export interface Tokens {
  prompt_tokens: number;
  completion_tokens: number;
  /** Prompt tokens read from cache, part of `prompt_tokens`. */
  cached_tokens?: number;
  /** How long generation took, for analytics' throughput; never sent to the client. */
  generationMs?: number;
}

/** One step of a streamed reply. Each field is optional: a stream ends with `usage`. */
export interface ChatChunk {
  delta?: ChatDelta;
  finish_reason?: FinishReason;
  usage?: Tokens;
  /** An error after the reply started: sent as an SSE event, and the stream ends. */
  error?: { code: number | string; message: string };
}

/** A whole reply at once. */
export interface ChatResponse {
  message: { content: string | null; reasoning?: string; tool_calls?: ToolCall[] };
  finish_reason: FinishReason;
  usage: Tokens;
}

/** Who asks: the key the request authenticated with. */
export interface ChatContext {
  keyHash: string;
  keyName: string;
  keyLabel: string;
}

/**
 * What answers chat completions, such as the scripted model of the e2e suite. It returns a
 * whole reply or a stream of chunks, whatever the request's `stream`: the fake streams a whole
 * reply as chunks, and assembles chunks into one reply for a request without `stream`. A
 * stream may wait between chunks. To fail before the reply starts, as OpenRouter does with an
 * HTTP status, it throws an `HttpError` from e2e/fakes/http.ts with OpenRouter's error body.
 * Without `usage`, the fake estimates the tokens from the text.
 */
export type Completions = (
  request: ChatRequest,
  context: ChatContext,
) => ChatResponse | AsyncIterable<ChatChunk> | Promise<ChatResponse | AsyncIterable<ChatChunk>>;

/** A rough, deterministic token count: four characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The default `Completions`: always `text`, with tokens estimated from the request and the text. */
export function fixedText(text = "OK."): Completions {
  return (request) => {
    const completion = estimateTokens(text);
    return {
      message: { content: text },
      finish_reason: "stop",
      usage: {
        prompt_tokens: estimateTokens(JSON.stringify(request.messages)),
        completion_tokens: completion,
        // 50 tokens per second.
        generationMs: completion * 20,
      },
    };
  };
}

/** A reply's chunks: those of a stream, or a whole reply's as one content chunk and one usage chunk. */
export async function* chunksOf(
  reply: ChatResponse | AsyncIterable<ChatChunk>,
): AsyncGenerator<ChatChunk> {
  if (Symbol.asyncIterator in reply) {
    yield* reply;
    return;
  }
  const { message } = reply;
  yield {
    delta: {
      role: "assistant",
      ...(message.content !== null ? { content: message.content } : {}),
      ...(message.reasoning !== undefined ? { reasoning: message.reasoning } : {}),
      ...(message.tool_calls
        ? { tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) }
        : {}),
    },
    finish_reason: reply.finish_reason,
  };
  yield { usage: reply.usage };
}

/** What a reply came to, once served: its tokens, as given or estimated. */
export interface Served {
  tokens: Tokens;
  /** True when the client went away or the reply ended with an error. */
  incomplete: boolean;
}

interface Envelope {
  id: string;
  created: number;
  model: string;
  /** The cost of `tokens`, in USD. */
  price: (tokens: Tokens) => number;
}

/** The reply as one JSON body, from all its chunks. */
export async function sendJson(
  response: ServerResponse,
  reply: ChatResponse | AsyncIterable<ChatChunk>,
  request: ChatRequest,
  envelope: Envelope,
): Promise<Served> {
  const assembly = new Assembly();
  for await (const chunk of chunksOf(reply)) {
    assembly.add(chunk);
    if (chunk.error) {
      const code = typeof chunk.error.code === "number" ? chunk.error.code : 502;
      write(response, code, { error: { code, message: chunk.error.message } });
      return { tokens: assembly.tokens(request), incomplete: true };
    }
  }
  const tokens = assembly.tokens(request);
  write(response, 200, {
    id: envelope.id,
    provider: "Fake",
    model: envelope.model,
    object: "chat.completion",
    created: envelope.created,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: assembly.finish ?? "stop",
        native_finish_reason: assembly.finish ?? "stop",
        message: assembly.message(),
      },
    ],
    usage: usageOf(tokens, envelope.price(tokens)),
  });
  return { tokens, incomplete: false };
}

/**
 * The reply as OpenRouter's SSE: a `: OPENROUTER PROCESSING` comment, a chunk per delta, then a
 * usage chunk that repeats the finish reason, and `[DONE]` (streaming.md, "The final usage
 * chunk"). An error chunk ends the stream with an error event instead.
 */
export async function sendStream(
  response: ServerResponse,
  reply: ChatResponse | AsyncIterable<ChatChunk>,
  request: ChatRequest,
  envelope: Envelope,
): Promise<Served> {
  const assembly = new Assembly();
  let closed = false;
  response.once("close", () => {
    closed = true;
  });
  const base = () => ({
    id: envelope.id,
    provider: "Fake",
    model: envelope.model,
    object: "chat.completion.chunk",
    created: envelope.created,
  });
  const event = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(": OPENROUTER PROCESSING\n\n");
  let started = false;
  for await (const chunk of chunksOf(reply)) {
    if (closed) return { tokens: assembly.tokens(request), incomplete: true };
    assembly.add(chunk);
    if (chunk.error) {
      event({
        ...base(),
        error: chunk.error,
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      });
      response.end();
      return { tokens: assembly.tokens(request), incomplete: true };
    }
    if (!chunk.delta && !chunk.finish_reason) continue;
    const delta = { ...(started ? {} : { role: "assistant" }), ...chunk.delta };
    started = true;
    const finish = chunk.finish_reason ?? null;
    event({
      ...base(),
      choices: [
        { index: 0, delta, finish_reason: finish, native_finish_reason: finish, logprobs: null },
      ],
    });
  }
  if (closed) return { tokens: assembly.tokens(request), incomplete: true };
  const tokens = assembly.tokens(request);
  const finish = assembly.finish ?? "stop";
  event({
    ...base(),
    choices: [
      {
        index: 0,
        delta: { content: "", role: "assistant" },
        finish_reason: finish,
        native_finish_reason: finish,
        logprobs: null,
      },
    ],
    usage: usageOf(tokens, envelope.price(tokens)),
  });
  response.end("data: [DONE]\n\n");
  return { tokens, incomplete: false };
}

/** The `usage` object OpenRouter sends (usage-accounting.md, "Response Format"). */
function usageOf(tokens: Tokens, cost: number) {
  return {
    prompt_tokens: tokens.prompt_tokens,
    completion_tokens: tokens.completion_tokens,
    total_tokens: tokens.prompt_tokens + tokens.completion_tokens,
    cost,
    is_byok: false,
    prompt_tokens_details: { cached_tokens: tokens.cached_tokens ?? 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
    cost_details: { upstream_inference_cost: null },
  };
}

/** A reply put together from its chunks: tool calls merged by index, as clients do. */
class Assembly {
  content = "";
  reasoning = "";
  readonly calls: ToolCall[] = [];
  finish: FinishReason | undefined;
  usage: Tokens | undefined;

  add(chunk: ChatChunk): void {
    const delta = chunk.delta;
    if (delta?.content) this.content += delta.content;
    if (delta?.reasoning) this.reasoning += delta.reasoning;
    for (const part of delta?.tool_calls ?? []) {
      const call = this.calls[part.index] ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      this.calls[part.index] = call;
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    if (chunk.finish_reason) this.finish = chunk.finish_reason;
    if (chunk.usage) this.usage = chunk.usage;
  }

  message() {
    const calls = this.calls.filter((call) => call !== undefined);
    return {
      role: "assistant",
      content: this.content === "" && calls.length > 0 ? null : this.content,
      ...(this.reasoning ? { reasoning: this.reasoning } : {}),
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    };
  }

  /** The usage given, or one estimated from the request and what was generated. */
  tokens(request: ChatRequest): Tokens {
    if (this.usage) return this.usage;
    const calls = this.calls.length > 0 ? JSON.stringify(this.calls) : "";
    return {
      prompt_tokens: estimateTokens(JSON.stringify(request.messages)),
      completion_tokens: estimateTokens(this.content + this.reasoning + calls),
    };
  }
}

function write(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
