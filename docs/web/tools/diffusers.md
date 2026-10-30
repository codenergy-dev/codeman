---
title: Diffusers
url: https://huggingface.co/docs/diffusers
created_at: 2026-10-30T11:40:01-03:00
updated_at: 2026-10-30T11:40:01-03:00
---

# Diffusers

How to record pages of the documentation of Diffusers, Hugging Face's library of diffusion pipelines, `huggingface.co/docs/diffusers`.

- **Version.** Record pages at the release tag the repository installs, such as `v0.41.0`: `https://huggingface.co/docs/diffusers/<tag>/en/<path>.md`, such as `v0.41.0/en/optimization/memory.md`, which answers as Markdown. The `url` is the same without `.md`. The pages are built from `docs/source/en/` in [huggingface/diffusers](https://github.com/huggingface/diffusers).
- **Title.** The first heading of the `.md` answer, such as "Reduce memory usage".
- **License.** The repository, documentation included, is Apache-2.0. Check that the tag's `LICENSE` still says so, then copy pages in full, with `license: Apache-2.0`.
- **Models.** A pipeline's weights are a model on the Hub: record it with the [Hugging Face tool](hugging-face.md).

```sh
TAG=v0.41.0
curl -fsS "https://raw.githubusercontent.com/huggingface/diffusers/$TAG/LICENSE" | head -3
curl -fsS "https://huggingface.co/docs/diffusers/$TAG/en/optimization/memory.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
