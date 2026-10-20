---
title: Delete an API key
url: https://openrouter.ai/docs/api/api-reference/api-keys/delete-an-api-key
created_at: 2026-10-20T13:31:26-03:00
updated_at: 2026-10-20T13:31:26-03:00
tool: docs/web/tools/openrouter.md
---

# Delete an API key

What Codeman relies on, in its own words. The page's license does not allow copying it. Codeman disables keys rather than deleting them, so their usage still counts ([Update an API key](update-an-api-key.md)).

- `DELETE https://openrouter.ai/api/v1/keys/{hash}`, with a management key as the bearer token.
- `200` with `{ "deleted": true }`; `404` with OpenRouter's error body when no key has the hash; `401`, `429` and `500` otherwise (OpenAPI `responses`).
