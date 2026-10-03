---
title: Update an API key
url: https://openrouter.ai/docs/api/api-reference/api-keys/update-an-api-key
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# Update an API key

What Codeman relies on, in its own words. The page's license does not allow copying it.

- `PATCH https://openrouter.ai/api/v1/keys/{hash}`, with a management key as the bearer token. `hash` (path, required) is the key's identifier.
- Body fields, each optional: `disabled` (whether the key is disabled), `name`, `limit` (USD), `limit_reset` and `include_byok_in_limit`, as in [Create a new API key](create-a-new-api-key.md).
- A disabled key stays listed with `include_disabled`, with its usage ([List API keys](list-api-keys.md)).
