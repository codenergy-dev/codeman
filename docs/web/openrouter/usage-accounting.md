---
title: Usage Accounting
url: https://openrouter.ai/docs/cookbook/administration/usage-accounting
created_at: 2026-10-20T13:31:27-03:00
updated_at: 2026-10-20T13:31:27-03:00
tool: docs/web/tools/openrouter.md
---

# Usage Accounting

What Codeman relies on, in its own words. The page's license does not allow copying it.

- Every response carries `usage`, with no parameter needed: in the whole response, or in the last SSE message of a stream. `usage: { include: true }` and `stream_options: { include_usage: true }` are deprecated and have no effect ("Usage Information").
- `usage` has `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (what the account is charged), `cost_details.upstream_inference_cost`, `prompt_tokens_details` (`cached_tokens`: read from cache; `cache_write_tokens`) and `completion_tokens_details.reasoning_tokens` ("Response Format", "Cost Breakdown").
