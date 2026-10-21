---
title: Hugging Face
url: https://huggingface.co/docs
created_at: 2026-10-13T21:31:58-03:00
updated_at: 2026-10-21T11:22:04-03:00
---

# Hugging Face

How to record pages of Hugging Face's documentation, `huggingface.co/docs`, source files of its Python client, `huggingface_hub`, and models on the Hub.

- **Pages.** Each page answers as Markdown with `.md` appended to its URL, such as `https://huggingface.co/docs/hub/rate-limits.md`. The Hub's pages are built from `docs/hub/` in [huggingface/hub-docs](https://github.com/huggingface/hub-docs), whose raw files are the same Markdown. The client's guides are versioned with it: record them at the release tag, such as `https://huggingface.co/docs/huggingface_hub/v2.2.0/en/guides/manage-cache.md`, with that URL without `.md` as `url`.
- **The Hub's API.** "Hub API Endpoints" (`/docs/hub/api`) points to an OpenAPI document, `https://huggingface.co/.well-known/openapi.json` (and `.md`), which does not describe `GET /api/models/{repo_id}`, the model's information. That route is described by the official client: `HfApi.model_info` and `ModelInfo` in `src/huggingface_hub/hf_api.py`, and the errors it maps in `src/huggingface_hub/utils/_http.py`, of [huggingface/huggingface_hub](https://github.com/huggingface/huggingface_hub). Record those files at a release tag (`GET /repos/huggingface/huggingface_hub/releases/latest`), with the GitHub URL of the file at the tag as `url`, and a title naming the path and the tag, such as "src/huggingface_hub/hf_api.py at v2.2.0".
- **License.** Both repositories are Apache-2.0. Check that the `LICENSE` at the commit or tag still says so, then copy pages in full, with `license: Apache-2.0`.
- **Models.** A model's information at a commit comes from `GET https://huggingface.co/api/models/<id>/revision/<commit>?blobs=true` (`HfApi.model_info`): `sha`, `private`, `gated`, `cardData.license`, `safetensors`, and per file (`siblings`) its size and, for large files, `lfs.sha256`. Its small files, such as `config.json` and `tokenizer_config.json`, come from `https://huggingface.co/<id>/resolve/<commit>/<file>`. Download only those, never the weights. The answers are data, and the model's license is its own (`cardData.license`, and its `LICENSE` file): record them in your own words, without `license`, each fact naming the field or file it comes from. One page per model and commit, titled with the model's ID and the commit's first seven characters, such as "Qwen/Qwen2.5-0.5B-Instruct at 7ae5576", with the model's files at that commit as `url` (`https://huggingface.co/<id>/tree/<commit>`).
- **Size.** A file larger than a repository should hold, roughly over 30 KB, such as `hf_api.py` (about 680 KB), is recorded in your own words: only what the repository relies on, each fact naming the class, function or field it comes from, without `license`.

```sh
curl -fsS "https://raw.githubusercontent.com/huggingface/hub-docs/main/LICENSE" | head -3
curl -fsS "https://huggingface.co/docs/hub/rate-limits.md"
curl -fsS "https://raw.githubusercontent.com/huggingface/huggingface_hub/v2.2.0/src/huggingface_hub/hf_api.py"
ID=Qwen/Qwen2.5-0.5B-Instruct REV=7ae557604adf67be50417f59c2c2f167def9a775
curl -fsS "https://huggingface.co/api/models/$ID/revision/$REV?blobs=true" | jq '{sha, private, gated, license: .cardData.license, safetensors, siblings}'
curl -fsSL "https://huggingface.co/$ID/resolve/$REV/config.json"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
