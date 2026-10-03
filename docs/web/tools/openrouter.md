---
title: OpenRouter
url: https://openrouter.ai/docs
created_at: 2026-10-02T21:52:44-03:00
updated_at: 2026-10-02T21:52:44-03:00
---

# OpenRouter

How to record pages of OpenRouter's documentation, `openrouter.ai/docs`.

- **Source.** Each page answers as Markdown with `.md` appended to its URL. `https://openrouter.ai/docs/llms.txt` lists every page with its Markdown URL and a summary. API reference pages embed the OpenAPI description of their endpoint.
- **License.** OpenRouter's terms reserve its materials to OpenRouter and its licensors, and the documentation states no license that allows copying. The OpenAPI description's `info.license` (MIT) describes the API, not the documentation. So pages are recorded in your own words, without `license`.
- **Skills.** OpenRouter also publishes guides for agents under `https://openrouter.ai/skills/<name>`, which answer as Markdown too, such as the analytics schema. The same license applies.

```sh
curl -fsS "https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3, for a page in your own words.
