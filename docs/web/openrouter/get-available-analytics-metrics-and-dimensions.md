---
title: Get available analytics metrics and dimensions
url: https://openrouter.ai/docs/api/api-reference/analytics/get-available-analytics-metrics-and-dimensions
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# Get available analytics metrics and dimensions

What Codeman relies on, in its own words. The page's license does not allow copying it.

- `GET https://openrouter.ai/api/v1/analytics/meta`, with a management key as the bearer token, lists what [Query analytics data](query-analytics-data.md) accepts: `metrics`, `dimensions`, `operators` and `granularities`.
- Each metric has a `name` (used in queries), a `display_label`, a `display_format` (`number`, `currency`, `percent`, `latency` or `throughput`) and `is_rate`: a rate is averaged, not summed. Codeman therefore combines rows of a rate metric, such as `avg_throughput`, with a mean weighted by requests, never a sum.
