---
title: Limits
url: https://openrouter.ai/docs/api_reference/limits
created_at: 2026-10-20T13:31:43-03:00
updated_at: 2026-10-20T13:31:43-03:00
tool: docs/web/tools/openrouter.md
---

# Limits

What Codeman relies on, in its own words. The page's license does not allow copying it.

- **Credit limits** come from the account's balance, the key's own `limit` (with `limit_reset` and `limit_remaining`), and the in-flight spending budget; each answers `402` when spent ("Credit limits").
- **A `402`'s `error.metadata.limit_source`** tells which: `openrouter_key_limit` when the key's limit is used up, `openrouter_credits` when the balance cannot cover the request, `openrouter_in_flight_budget` for the transient in-flight budget, with `Retry-After`. Each such `402` also has a human-readable `remedy_hint` ("In-flight spending budget", "Handling 402 errors").
- **OpenRouter charges a request when it finishes**; the in-flight budget holds an estimate while it runs ("In-flight spending budget").
- **`GET /api/v1/key`** shows a key's `limit`, `limit_remaining` and usage, to watch them before requests fail ("Checking your limits"); see [Get current API key](get-current-api-key.md).
- **Budget limits** set by an organization's admin (guardrails, workspace budgets) answer `403` when spent, apart from the key's own limit ("Budget limits", "Handling 403 budget errors").
