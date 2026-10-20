---
title: Create a chat completion
url: https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion
created_at: 2026-10-20T13:31:22-03:00
updated_at: 2026-10-20T13:31:22-03:00
tool: docs/web/tools/openrouter.md
---

# Create a chat completion

What Codeman relies on, in its own words. The page's license does not allow copying it. The e2e suite's fake OpenRouter (`e2e/fakes/openrouter/`) follows it; OpenCode's `openrouter` provider calls it with a run's key.

## Request

- `POST https://openrouter.ai/api/v1/chat/completions`, with an API key as the bearer token (OpenAPI `security`).
- Body (`ChatRequest`): `model` and `messages`, plus optional `stream`, `tools`, `tool_choice`, `max_tokens` and others, as in OpenAI's API.

## Response

- `200` with `application/json` (`ChatResult`): `id`, `object: chat.completion`, `created` (Unix seconds), `model`, `system_fingerprint` (may be null), `choices` and `usage`.
- Each choice (`ChatChoice`) has `index`, `finish_reason` (`ChatFinishReasonEnum`: such as `stop`, `length`, `tool_calls`, `error`) and `message`: `role`, `content`, and `tool_calls`, each with `id`, `type: function` and `function` (`name`, `arguments` as a JSON string).
- `200` with `text/event-stream` when `stream` is true: `data:` events of `ChatStreamChunk` (`object: chat.completion.chunk`, `choices` with a `delta`), ending with the `[DONE]` sentinel. A chunk may carry a top-level `error` with `code` and `message`. Tool calls stream as `ChatStreamToolCall` parts keyed by `index`.
- `usage` (`ChatUsage`): `prompt_tokens`, `completion_tokens` and `total_tokens` (required), `cost` (USD, may be null), `is_byok`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` and `cost_details`.

## Errors

- `400`, `401`, `402`, `403`, `404`, `408`, `429`, `500`, `502` and `503`, each with the body `{ "error": { "code", "message" } }` (OpenAPI `responses`). The `402` example says the credits are insufficient.
