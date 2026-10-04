---
title: Ollama
url: https://docs.ollama.com
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
---

# Ollama

How to record pages of Ollama's documentation, `docs.ollama.com`.

- **Source.** Each page answers as Markdown with `.md` appended to its URL, such as `https://docs.ollama.com/context-length.md`. `https://docs.ollama.com/llms.txt` lists every page. The pages are built from `docs/` in [ollama/ollama](https://github.com/ollama/ollama).
- **License.** The repository, documentation included, is MIT. Pages are copied in full, with `license: MIT`.
- **Title.** The first heading of the `.md` answer, such as "Context length".
- **Versions.** Pages describe the latest release. The version the repository pins belongs where it documents its dependencies, not in the copy.

```sh
curl -fsS "https://docs.ollama.com/context-length.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
