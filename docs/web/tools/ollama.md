---
title: Ollama
url: https://docs.ollama.com
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-08T23:19:39-03:00
---

# Ollama

How to record pages of Ollama's documentation, `docs.ollama.com`.

- **Source.** Each page answers as Markdown with `.md` appended to its URL, such as `https://docs.ollama.com/context-length.md`. `https://docs.ollama.com/llms.txt` lists every page. The pages are built from `docs/` in [ollama/ollama](https://github.com/ollama/ollama).
- **License.** The repository, documentation included, is MIT. Pages are copied in full, with `license: MIT`.
- **Title.** The first heading of the `.md` answer, such as "Context length".
- **Versions.** Pages describe the latest release. The version the repository pins belongs where it documents its dependencies, not in the copy.
- **Source files.** What the pages do not list, such as every environment variable the server reads, is in the source of the release the repository pins, at its tag: `https://raw.githubusercontent.com/ollama/ollama/<tag>/<path>`, such as `v0.35.1/envconfig/config.go`. Check that the tag's `LICENSE` is still MIT, then copy the file in full inside a fenced code block of its language, with `license: MIT`, the GitHub URL of the file at its tag as `url`, and a title naming the path and the tag, such as "envconfig/config.go at v0.35.1".

```sh
curl -fsS "https://docs.ollama.com/context-length.md"
curl -fsS "https://raw.githubusercontent.com/ollama/ollama/v0.35.1/LICENSE" | head -1
curl -fsS "https://raw.githubusercontent.com/ollama/ollama/v0.35.1/envconfig/config.go"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
