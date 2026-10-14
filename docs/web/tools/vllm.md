---
title: vLLM
url: https://docs.vllm.ai
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
---

# vLLM

How to record pages and source files of vLLM, `docs.vllm.ai`, and of its recipes, `recipes.vllm.ai`.

- **Version.** Record everything at the tag of the vLLM release the repository pins, such as `v0.31.0`: the site's pages change with every release, and options with them.
- **Source.** The site is built from `docs/` in [vllm-project/vllm](https://github.com/vllm-project/vllm), and its `.md` URLs answer 404. Take the raw file at the tag: `https://raw.githubusercontent.com/vllm-project/vllm/<tag>/docs/<path>.md`. The `url` is the page on the site at that version, `https://docs.vllm.ai/en/<tag>/<path>/`. Pages made of generated lists, such as "Engine Arguments", hold only an include marker (`--8<-- "gen:engine-args"`): record the source file the list is generated from instead.
- **Source files.** `https://raw.githubusercontent.com/vllm-project/vllm/<tag>/<path>`, such as `v0.31.0/vllm/v1/core/kv_cache_utils.py`, copied in full inside a fenced code block of its language, with the GitHub URL of the file at its tag as `url`, and a title naming the path and the tag, such as "vllm/tool_parsers/__init__.py at v0.31.0".
- **Release notes.** `https://api.github.com/repos/vllm-project/vllm/releases/tags/<tag>`, field `body`, with the release page as `url` and the tag as title, such as "v0.31.0".
- **Recipes.** [vllm-project/recipes](https://github.com/vllm-project/recipes) has one YAML file per model, such as `models/Qwen/Qwen3.8-27B.yaml`, and no tags: record the file at the commit that last changed it (`GET /repos/vllm-project/recipes/commits?path=<path>&per_page=1`), with a title naming the path and the short commit, such as "models/Qwen/Qwen3.8-27B.yaml at d0f2838".
- **License.** Both repositories, documentation included, are Apache-2.0. Check that the tag's or commit's `LICENSE` still says so, then copy pages, files and release notes in full, with `license: Apache-2.0`.
- **Size.** A file larger than a repository should hold, roughly over 30 KB, such as `vllm/engine/arg_utils.py`, is recorded in your own words: only what the repository relies on, each fact naming the function, class or option it comes from, without `license`.

```sh
TAG=v0.31.0
curl -fsS "https://raw.githubusercontent.com/vllm-project/vllm/$TAG/LICENSE" | head -3
curl -fsS "https://raw.githubusercontent.com/vllm-project/vllm/$TAG/docs/configuration/conserving_memory.md"
curl -fsS "https://api.github.com/repos/vllm-project/vllm/releases/tags/$TAG" | jq -r .body
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
