---
title: llama.cpp
url: https://github.com/ggml-org/llama.cpp
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
---

# llama.cpp

How to record source files of llama.cpp, which Ollama runs as `llama-server` in Codeman's pod image.

- **Version.** Ollama pins the llama.cpp tag it builds in its `LLAMA_CPP_VERSION` file, at Ollama's own tag, such as `b11232` for Ollama v0.35.1 ([LLAMA_CPP_VERSION at v0.35.1](../ollama/llama-cpp-version-at-v0-35-1.md)). Record files at that tag.
- **Source.** `https://raw.githubusercontent.com/ggml-org/llama.cpp/<tag>/<path>`, such as `b11232/common/fit.h`.
- **License.** The repository is MIT. Check that the tag's `LICENSE` still says so, then copy the file in full inside a fenced code block of its language, with `license: MIT`, the GitHub URL of the file at its tag as `url`, and a title naming the path and the tag, such as "common/fit.h at b11232".
- **Size.** A file larger than a repository should hold, roughly over 30 KB, is recorded in your own words: only what the repository relies on, each fact naming the function or option it comes from, without `license`.

```sh
curl -fsS "https://raw.githubusercontent.com/ggml-org/llama.cpp/b11232/LICENSE" | head -1
curl -fsS "https://raw.githubusercontent.com/ggml-org/llama.cpp/b11232/common/fit.h"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
