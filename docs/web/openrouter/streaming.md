---
title: Streaming
url: https://openrouter.ai/docs/api_reference/streaming
created_at: 2026-10-20T13:31:23-03:00
updated_at: 2026-10-20T13:31:23-03:00
tool: docs/web/tools/openrouter.md
---

# Streaming

What Codeman relies on, in its own words. The page's license does not allow copying it.

- **Comments.** A stream may hold SSE comments, such as `: OPENROUTER PROCESSING`, to keep the connection open; clients skip lines that start with `:` ("Additional information").
- **The usage chunk.** On `/api/v1/chat/completions`, every stream ends with one more chunk carrying `usage`, just before `data: [DONE]`. Unlike OpenAI's empty `choices`, it holds one choice whose `delta` is `{ "content": "", "role": "assistant" }` and which repeats the stream's `finish_reason` and `native_finish_reason` ("The final usage chunk (Chat Completions)").
- **Cancellation.** Aborting the connection stops processing and billing, for supported providers only ("Stream cancellation").
- **Errors before the response is committed** come as a JSON body with the HTTP status: `400`, `401`, `402`, `429`, `502` or `503` ("Errors before the response is committed").
- **Errors mid-stream** keep the `200`: one `data:` event with a top-level `error` (`code`, `message`) beside the usual fields, and a choice with `finish_reason: "error"`; the stream ends after it. It may be the only event ("Errors after the response is committed (mid-stream)").
