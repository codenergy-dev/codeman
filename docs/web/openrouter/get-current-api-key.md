---
title: Get current API key
url: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
created_at: 2026-10-20T13:31:24-03:00
updated_at: 2026-10-20T13:31:24-03:00
tool: docs/web/tools/openrouter.md
---

# Get current API key

What Codeman relies on, in its own words. The page's license does not allow copying it.

- `GET https://openrouter.ai/api/v1/key`, with the key itself as the bearer token: details of the key the request authenticates with (OpenAPI `/key`).
- `data` holds, among others: `label`, `limit`, `limit_remaining`, `limit_reset`, `include_byok_in_limit`, `usage` with its `_daily`, `_weekly` and `_monthly` variants, the `byok_usage` ones, `is_free_tier`, `is_management_key`, `is_provisioning_key`, `expires_at`, `budgets` and `effective_budget` (OpenAPI `200` example). The label shows the key's start and end, such as `sk-or-v1-au7...890`.
- Errors answer `401` among others, with OpenRouter's error body.
