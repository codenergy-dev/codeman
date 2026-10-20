import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import { HttpError } from "../http.ts";
import type {
  ChatChunk,
  ChatRequest,
  Completions,
  FinishReason,
  Tokens,
  ToolCall,
} from "../openrouter/chat.ts";
import type { QueueBackend } from "../runpod/serverless.ts";
import type { ScriptedModel, Via } from "./model.ts";

/**
 * The scripted model on the wire, as an OpenAI-compatible engine such as vLLM or Ollama answers
 * `POST /v1/chat/completions`: Server-Sent Events of `chat.completion.chunk`s, with tool calls
 * streamed by index, a usage chunk when `stream_options.include_usage` asks for it (the gateway
 * always does), then `[DONE]`; or one `chat.completion` without `stream`.
 *
 * `reply` does not depend on a server, so a proxy such as the tee can hold the reply while the
 * real engine answers, then send it with `sendReply`. The adapters plug the same model into the
 * fake OpenRouter (`completions`, `remoteCompletions`) and the fake Runpod queue (`queueBackend`).
 */

/** A reply, ready for any transport: its body's strings are SSE events, or one JSON body. */
export interface WireReply {
  status: number;
  headers: Record<string, string>;
  /** Throws `AbruptEnd` when the connection must drop, after or before some events. */
  body: AsyncIterable<string>;
}

const SSE = { "content-type": "text/event-stream", "cache-control": "no-cache" };
const JSON_TYPE = { "content-type": "application/json" };

/** The model's answer to `request`, as an OpenAI-compatible engine sends it. */
export function reply(
  model: ScriptedModel,
  request: ChatRequest,
  via: Via = "openai",
  signal?: AbortSignal,
): WireReply {
  if (typeof request?.model !== "string" || !Array.isArray(request.messages)) {
    return errorReply(400, "model and messages are required.");
  }
  const answer = model.answer(request, via, signal);
  if ("error" in answer) return errorReply(answer.error.status, answer.error.message);
  const id = `chatcmpl-${createHash("sha256")
    .update(answer.log.call?.id ?? JSON.stringify(request.messages))
    .digest("hex")
    .slice(0, 24)}`;
  const envelope = { id, created: 0, model: request.model };
  if (request.stream === true) {
    const options = request.stream_options as { include_usage?: unknown } | undefined;
    return {
      status: 200,
      headers: SSE,
      body: events(answer.chunks, envelope, options?.include_usage === true),
    };
  }
  return { status: 200, headers: JSON_TYPE, body: whole(answer.chunks, envelope) };
}

/** Writes a reply as it comes; one that ends abruptly drops the connection. */
export async function sendReply(response: ServerResponse, wire: WireReply): Promise<void> {
  try {
    for await (const text of wire.body) {
      if (response.destroyed) return;
      if (!response.headersSent) {
        response.writeHead(wire.status, wire.headers);
        response.flushHeaders();
      }
      response.write(text);
    }
    if (!response.headersSent) response.writeHead(wire.status, wire.headers);
    response.end();
  } catch {
    response.destroy();
  }
}

/** The `/v1/models` answer. */
export function modelList(models: readonly string[]) {
  return {
    object: "list",
    data: models.map((id) => ({ id, object: "model", created: 0, owned_by: "codeman-e2e" })),
  };
}

interface Envelope {
  id: string;
  created: number;
  model: string;
}

async function* events(
  chunks: AsyncIterable<ChatChunk>,
  envelope: Envelope,
  includeUsage: boolean,
): AsyncGenerator<string> {
  const base = { ...envelope, object: "chat.completion.chunk" };
  let usage: Tokens | undefined;
  for await (const chunk of chunks) {
    if (chunk.usage) usage = chunk.usage;
    if (!chunk.delta && !chunk.finish_reason) continue;
    yield event({
      ...base,
      choices: [
        {
          index: 0,
          delta: chunk.delta ?? {},
          logprobs: null,
          finish_reason: chunk.finish_reason ?? null,
        },
      ],
    });
  }
  if (includeUsage && usage) yield event({ ...base, choices: [], usage: usageOf(usage) });
  yield "data: [DONE]\n\n";
}

async function* whole(
  chunks: AsyncIterable<ChatChunk>,
  envelope: Envelope,
): AsyncGenerator<string> {
  const assembly = new Assembly();
  for await (const chunk of chunks) assembly.add(chunk);
  yield JSON.stringify({
    ...envelope,
    object: "chat.completion",
    choices: [
      { index: 0, message: assembly.message(), logprobs: null, finish_reason: assembly.finish },
    ],
    ...(assembly.usage ? { usage: usageOf(assembly.usage) } : {}),
  });
}

function event(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function usageOf(tokens: Tokens) {
  return {
    prompt_tokens: tokens.prompt_tokens,
    completion_tokens: tokens.completion_tokens,
    total_tokens: tokens.prompt_tokens + tokens.completion_tokens,
    ...(tokens.cached_tokens === undefined
      ? {}
      : { prompt_tokens_details: { cached_tokens: tokens.cached_tokens } }),
  };
}

function errorReply(status: number, message: string): WireReply {
  const body = { error: { message, type: "invalid_request_error", code: status } };
  return {
    status,
    headers: JSON_TYPE,
    body: (async function* () {
      yield JSON.stringify(body);
    })(),
  };
}

/** Chunks put together into one message: tool calls merged by index, as clients do. */
export class Assembly {
  content = "";
  readonly calls: ToolCall[] = [];
  finish: FinishReason = "stop";
  usage: Tokens | undefined;

  add(chunk: ChatChunk): void {
    if (chunk.delta?.content) this.content += chunk.delta.content;
    for (const part of chunk.delta?.tool_calls ?? []) {
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
    return {
      role: "assistant",
      content: this.content === "" && this.calls.length > 0 ? null : this.content,
      ...(this.calls.length > 0 ? { tool_calls: this.calls } : {}),
    };
  }
}

/** The model as the fake OpenRouter's `Completions`, in the same process. */
export function completions(model: ScriptedModel): Completions {
  return (request) => {
    const answer = model.answer(request, "openrouter");
    if ("error" in answer) {
      throw new HttpError(answer.error.status, {
        error: { code: answer.error.status, message: answer.error.message },
      });
    }
    return answer.chunks;
  };
}

/**
 * The fake OpenRouter's `Completions` from the scripted model's server at `origin`, when they run
 * as separate services: each request is streamed from `${origin}/v1/chat/completions`.
 */
export function remoteCompletions(origin: string, fetchFn: typeof fetch = fetch): Completions {
  return async (request) => {
    const response = await fetchFn(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, stream: true, stream_options: { include_usage: true } }),
    });
    if (!response.ok) {
      const text = await response.text();
      const message = (() => {
        try {
          return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
        } catch {
          return text;
        }
      })();
      throw new HttpError(response.status, { error: { code: response.status, message } });
    }
    return chunksOfSse(response.body as unknown as AsyncIterable<Uint8Array>);
  };
}

/** An OpenAI-compatible SSE body, back into chunks. */
export async function* chunksOfSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<ChatChunk> {
  for await (const data of sseData(body)) {
    if (data === "[DONE]") return;
    const event = JSON.parse(data) as {
      choices?: { delta?: ChatChunk["delta"]; finish_reason?: FinishReason | null }[];
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const choice = event.choices?.[0];
    if (choice) {
      yield {
        ...(choice.delta && Object.keys(choice.delta).length > 0 ? { delta: choice.delta } : {}),
        ...(choice.finish_reason ? { finish_reason: choice.finish_reason } : {}),
      };
    }
    if (event.usage) {
      const cached = event.usage.prompt_tokens_details?.cached_tokens;
      yield {
        usage: {
          prompt_tokens: event.usage.prompt_tokens,
          completion_tokens: event.usage.completion_tokens,
          ...(cached === undefined ? {} : { cached_tokens: cached }),
        },
      };
    }
  }
}

/** The `data:` of each Server-Sent Event of a body. */
export async function* sseData(body: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const bytes of body) {
    buffered += (
      typeof bytes === "string" ? bytes : decoder.decode(bytes, { stream: true })
    ).replaceAll("\r\n", "\n");
    let end = buffered.indexOf("\n\n");
    while (end >= 0) {
      const block = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      if (data !== "") yield data;
      end = buffered.indexOf("\n\n");
    }
  }
}

/**
 * The model as the fake Runpod queue's worker, in the same process: what `openAiBackend` yields
 * from the scripted model's server, each SSE event one output, without HTTP.
 */
export function queueBackend(model: ScriptedModel, models: readonly string[]): QueueBackend {
  return {
    async *run(job, signal) {
      const input = (job.input ?? {}) as { openai_route?: unknown; openai_input?: unknown };
      if (input.openai_route === "/v1/models") {
        yield modelList(models);
        return;
      }
      if (input.openai_route !== "/v1/chat/completions") {
        throw new Error(`The scripted model does not serve ${String(input.openai_route)}.`);
      }
      const wire = reply(model, input.openai_input as ChatRequest, "queue", signal);
      if (wire.status !== 200) {
        let message = "";
        for await (const text of wire.body) message += text;
        yield { error: { status: wire.status, message } };
        return;
      }
      if (wire.headers["content-type"] === SSE["content-type"]) {
        yield* wire.body;
        return;
      }
      for await (const text of wire.body) yield JSON.parse(text);
    },
  };
}
