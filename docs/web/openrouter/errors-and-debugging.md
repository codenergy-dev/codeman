---
title: Errors and Debugging
url: https://openrouter.ai/docs/api_reference/errors-and-debugging
created_at: 2026-10-20T13:31:24-03:00
updated_at: 2026-10-20T13:31:24-03:00
tool: docs/web/tools/openrouter.md
---

# Errors and Debugging

What Codeman relies on, in its own words. The page's license does not allow copying it.

- An error's body is `{ "error": { "code": number, "message": string, "metadata"?: object } }`, and the HTTP status equals `error.code` when the request is invalid or the key or account is out of credits. Otherwise, the status is `200` and the error comes in the body or as an SSE event (the page's introduction).
- Codes ("Error codes"):

| Status | Meaning |
| --- | --- |
| 400 | Invalid or missing parameters |
| 401 | Invalid credentials: a disabled or invalid API key, or an expired OAuth session |
| 402 | The account or the API key has insufficient credits |
| 403 | Insufficient permissions, a guardrail block or a moderation flag |
| 408 | Timeout |
| 429 | Rate limited |
| 502 | The model is down or answered invalidly |
| 503 | No provider meets the routing requirements |

- `Retry-After` may come with `429`, `503`, and a `402` whose `error.metadata.limit_source` is `openrouter_in_flight_budget`; a `402` without it is not a case to retry ("Retry-After header").
