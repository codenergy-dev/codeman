---
title: Create a new API key
url: https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# Create a new API key

What Codeman relies on, in its own words. The page's license does not allow copying it.

## Request

`POST https://openrouter.ai/api/v1/keys`, with a management key as the bearer token. Body (OpenAPI request body):

- `name` (required): the key's name.
- `limit`: an optional spending limit, in USD.
- `limit_reset`: `daily`, `weekly`, `monthly` or null for a limit that never resets. Resets happen at midnight UTC; weeks run Monday to Sunday.
- `expires_at`: an optional expiry, in ISO 8601 UTC **with seconds** (`YYYY-MM-DDTHH:MM:SSZ`, fractional seconds allowed). A timestamp with minutes only is rejected.
- `include_byok_in_limit`: whether usage on the user's own provider keys counts towards the limit.
- `workspace_id`: the workspace to create the key in; the default workspace otherwise.

## Response

`201`, with `data` (the key's details, as in [List API keys](list-api-keys.md), `hash` included) and `key`: the key itself, shown only in this response.
