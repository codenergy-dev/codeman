---
title: Hugging Face
url: https://huggingface.co/docs
created_at: 2026-10-13T21:31:58-03:00
updated_at: 2026-10-13T21:31:58-03:00
---

# Hugging Face

How to record pages of Hugging Face's documentation, `huggingface.co/docs`, and source files of its Python client, `huggingface_hub`.

- **Pages.** Each page answers as Markdown with `.md` appended to its URL, such as `https://huggingface.co/docs/hub/rate-limits.md`. The Hub's pages are built from `docs/hub/` in [huggingface/hub-docs](https://github.com/huggingface/hub-docs), whose raw files are the same Markdown.
- **The Hub's API.** "Hub API Endpoints" (`/docs/hub/api`) points to an OpenAPI document, `https://huggingface.co/.well-known/openapi.json` (and `.md`), which does not describe `GET /api/models/{repo_id}`, the model's information. That route is described by the official client: `HfApi.model_info` and `ModelInfo` in `src/huggingface_hub/hf_api.py`, and the errors it maps in `src/huggingface_hub/utils/_http.py`, of [huggingface/huggingface_hub](https://github.com/huggingface/huggingface_hub). Record those files at a release tag (`GET /repos/huggingface/huggingface_hub/releases/latest`), with the GitHub URL of the file at the tag as `url`, and a title naming the path and the tag, such as "src/huggingface_hub/hf_api.py at v2.2.0".
- **License.** Both repositories are Apache-2.0. Check that the `LICENSE` at the commit or tag still says so, then copy pages in full, with `license: Apache-2.0`.
- **Size.** A file larger than a repository should hold, roughly over 30 KB, such as `hf_api.py` (about 680 KB), is recorded in your own words: only what the repository relies on, each fact naming the class, function or field it comes from, without `license`.

```sh
curl -fsS "https://raw.githubusercontent.com/huggingface/hub-docs/main/LICENSE" | head -3
curl -fsS "https://huggingface.co/docs/hub/rate-limits.md"
curl -fsS "https://raw.githubusercontent.com/huggingface/huggingface_hub/v2.2.0/src/huggingface_hub/hf_api.py"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
