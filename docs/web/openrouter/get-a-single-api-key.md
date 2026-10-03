---
title: Get a single API key
url: https://openrouter.ai/docs/api/api-reference/api-keys/get-a-single-api-key
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/openrouter.md
---

# Get a single API key

What Codeman relies on, in its own words. The page's license does not allow copying it.

- `GET https://openrouter.ai/api/v1/keys/{hash}`, with a management key as the bearer token. `hash` (path, required) is the key's identifier.
- The response's `data` holds the key's details, with the same fields as in [List API keys](list-api-keys.md), `usage` included.
