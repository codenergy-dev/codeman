---
title: src/huggingface_hub/utils/_http.py at v2.2.0
url: https://github.com/huggingface/huggingface_hub/blob/v2.2.0/src/huggingface_hub/utils/_http.py
created_at: 2026-10-13T21:31:58-03:00
updated_at: 2026-10-13T21:31:58-03:00
tool: docs/web/tools/hugging-face.md
---

# src/huggingface_hub/utils/_http.py at v2.2.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (49 KB). Each fact names the function it comes from.

## How the Hub reports errors

`hf_raise_for_status` reads a failed response's `X-Error-Code` and `X-Error-Message` headers:

- `RepoNotFound`, or a `401` on a repository's route that is not "Invalid credentials in Authorization header", means the repository was not found. The Hub answers `401` for a missing repository and for a private one when the caller cannot see it, so the client reports both alike: "make sure you specified the correct `repo_id` … If you are trying to access a private or gated repo, make sure you are authenticated".
- `GatedRepo`: the repository exists, but is gated and the caller is not on its list of authorized users.
- `RevisionNotFound` and `EntryNotFound`: a revision or a file that does not exist in a repository that does.
- `X-Error-Message` "Access to this resource is disabled.": a disabled repository.
- Any other `400` or `403` is a bad request or a refusal, with `X-Error-Message` as the reason.
