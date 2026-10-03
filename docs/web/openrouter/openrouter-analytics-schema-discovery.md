---
title: OpenRouter Analytics Schema Discovery
url: https://openrouter.ai/skills/openrouter-analytics-schema
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# OpenRouter Analytics Schema Discovery

What Codeman relies on, in its own words. The page's license does not allow copying it.

## Metrics ("Metric Categories")

- `request_count`: model requests, without server-tool rows. `tokens_prompt`, `tokens_completion`, `tokens_total`: token counts. `cached_tokens`: tokens served from cache, counted apart; the page does not say whether `tokens_prompt` includes them.
- Performance metrics come as `avg_`, `p50_`, `p90_`, `p95_` and `p99_` variants, in milliseconds unless noted:
  - `*_throughput`: completion tokens per second, `native_tokens_completion / generation_time`; null for a request without completion tokens.
  - `*_latency`: provider-side time to first token (the whole response when not streamed); `*_generation_time`: provider-side generation time.

## Time range limits ("Time Range Limits")

- Volume and cost metrics cover up to 367 days.
- Latency and throughput metrics, `hour` granularity, and per-generation dimensions (`generation_id`, `provider`, `finish_reason` and others) cover at most 31 days.
- A query past a limit fails with `400` and the maximum in its message; it is not cut.

## Dimensions ("Understanding Dimensions")

- `api_key_id` (the key's hash), `model` and others cover the long range.
- `generation_id` gives one row per request, so a query ordered by a metric with `limit: 1` returns the request where it is largest. There is no `max` aggregate.
