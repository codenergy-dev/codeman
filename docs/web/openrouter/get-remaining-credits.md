---
title: Get remaining credits
url: https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits
created_at: 2026-10-20T13:31:26-03:00
updated_at: 2026-10-20T13:31:26-03:00
tool: docs/web/tools/openrouter.md
---

# Get remaining credits

What Codeman relies on, in its own words. The page's license does not allow copying it.

- `GET https://openrouter.ai/api/v1/credits`, with a management key as the bearer token.
- `200` with `data.total_credits` (USD bought) and `data.total_usage` (USD used).
- Another key answers `403` with the message "Only management keys can perform this operation"; a missing one, `401` (OpenAPI `responses`).
