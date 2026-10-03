---
title: List API keys
url: https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# List API keys

What Codeman relies on, in its own words. The page's license does not allow copying it.

## Request

- `GET https://openrouter.ai/api/v1/keys`, with a management key as the bearer token.
- `include_disabled` (query, boolean as a string): whether disabled keys are listed. The page's example is `false`; Codeman passes `true`, so disabled keys still count.
- `offset` (query, integer from 0): how many keys to skip, for pagination. The page states no page size; a page with no keys ends the listing.
- `workspace_id` (query, UUID): the workspace whose keys are listed. Without it, only the default workspace's keys are listed.

## Response

`data` is a list of keys. Each has, among others (OpenAPI schema, "data" items):

- `hash`: the key's identifier, used by the other key endpoints and as `api_key_id` in analytics.
- `name`, `label`, `disabled`, `created_at`, `updated_at`, `expires_at` (null when it never expires), `workspace_id`.
- `limit` and `limit_remaining`: the spending limit and what remains of it, in USD; null without a limit. `limit_reset`: when the limit resets, or null.
- `usage`: the key's total credit usage, in USD. `usage_daily`, `usage_weekly` (Monday to Sunday) and `usage_monthly`: usage in the current UTC day, week and month.
- `byok_usage` and its daily, weekly and monthly variants: usage on the user's own provider keys, outside OpenRouter's credits.
