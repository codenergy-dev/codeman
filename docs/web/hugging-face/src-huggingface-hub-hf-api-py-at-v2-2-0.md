---
title: src/huggingface_hub/hf_api.py at v2.2.0
url: https://github.com/huggingface/huggingface_hub/blob/v2.2.0/src/huggingface_hub/hf_api.py
created_at: 2026-10-13T21:31:58-03:00
updated_at: 2026-10-13T21:31:58-03:00
tool: docs/web/tools/hugging-face.md
---

# src/huggingface_hub/hf_api.py at v2.2.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (684 KB). It is the Hub's official Python client, released on 2026-10-08; each fact names the function, class or field it comes from. The Hub's OpenAPI document does not describe this route ([tool](../tools/hugging-face.md)).

## The request

- `HfApi.model_info` gets one model's information with `GET https://huggingface.co/api/models/{repo_id}`, or `/api/models/{repo_id}/revision/{revision}` for a revision. `repo_id` is a namespace (a user or an organization) and a name, separated by `/`.
- A token is optional: without one, the call sees public models only ("Model can be private if you pass an acceptable token").
- `files_metadata=True` adds the query parameter `blobs=true`, which gives each file's size; `expand` (a list of properties, such as `safetensors` or `siblings`) returns only those properties, and cannot go with `blobs`.

## The response

Fields of `ModelInfo` Codeman reads, as the JSON names them:

- `id`: the model's ID. `sha`: the repository's commit at that revision.
- `private` (boolean): whether the repository is private.
- `gated`: `false`, or `"auto"` or `"manual"` when users must ask for access, approved automatically or by hand.
- `disabled` (boolean): whether the repository is disabled.
- `safetensors`: `parameters` (a count per data type) and `total`, present when the model has safetensors weights (`SafeTensorsInfo`).
- `siblings`: the repository's files (`RepoSibling`), each with `rfilename`, its path from the repository's root; with `blobs=true`, also `size` in bytes, `blobId` and `lfs` (`size`, `sha256`, `pointerSize`) for files stored with Git LFS. Without `blobs`, `size` is absent.
- `usedStorage`: the repository's size on the Hub, in bytes (`used_storage`).
