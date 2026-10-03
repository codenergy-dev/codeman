---
title: Query analytics data
url: https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# Query analytics data

What Codeman relies on, in its own words. The page's license does not allow copying it. Metric and dimension names are in [OpenRouter Analytics Schema Discovery](openrouter-analytics-schema-discovery.md).

## Request

`POST https://openrouter.ai/api/v1/analytics/query`, with a management key as the bearer token. Body (OpenAPI request body):

- `metrics` (required, at least one): the metrics to compute, such as `tokens_prompt` or `avg_throughput`.
- `dimensions` (at most 2): what to group rows by, such as `model`, `api_key_id` or `generation_id`.
- `filters` (at most 20): each a `field`, an `operator` and a `value`. A key is filtered by its hash: `{ "field": "api_key_id", "operator": "eq", "value": "<hash>" }`.
- `time_range`: `start` and `end` in ISO 8601 UTC **with seconds** (`YYYY-MM-DDTHH:MM:SSZ`); minute precision is rejected.
- `granularity`: a time bucket size (`minute`, `hour`, `day`, `week`, `month`).
- `order_by`: a `field` (a metric, a dimension or `date`) and a `direction` (`asc` or `desc`).
- `limit`: the most rows returned, 1,000 by default. `group_limit`: the most rows per combination of dimensions.

## Response

`data.data` is the list of rows, each with the requested dimensions and metrics. `data.metadata` has `row_count` and `truncated`, which is true when `limit` cut rows.

Not on the page: Codeman has received counts as strings, so it reads numbers from either.
