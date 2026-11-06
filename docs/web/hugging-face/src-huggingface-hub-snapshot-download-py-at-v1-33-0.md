---
title: src/huggingface_hub/_snapshot_download.py at v1.33.0
url: https://github.com/huggingface/huggingface_hub/blob/v1.33.0/src/huggingface_hub/_snapshot_download.py
created_at: 2026-11-06T14:50:00-03:00
updated_at: 2026-11-06T14:50:00-03:00
tool: docs/web/tools/hugging-face.md
---

# src/huggingface_hub/_snapshot_download.py at v1.33.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (31 KB). It is the version of `huggingface_hub` in vLLM's CPU image `v0.31.0`, which the e2e suite uses; each fact names the function it comes from.

## How `snapshot_download` finds a model offline

- **The default revision.** With no `revision`, `snapshot_download` uses `constants.DEFAULT_REVISION`, which `constants.py` sets to `"main"`.
- **Offline, or when the Hub cannot answer,** it knows no commit, so it looks in the cache: a file `refs/<revision>` under the repository's folder gives the commit, and the folder `snapshots/<commit>` is the snapshot. A revision that is already a commit is looked up in `snapshots/` directly.
- **No ref and no snapshot for the revision:** with `local_files_only`, or `HF_HUB_OFFLINE`, it raises `LocalEntryNotFoundError`: "Cannot find an appropriate cached snapshot folder for the specified revision on the local disk and outgoing traffic has been disabled."
- **After a download,** it records the commit under `refs/<revision>` through `_cache_commit_hash_for_specific_revision` ([file_download.py](src-huggingface-hub-file-download-py-at-v1-33-0.md)), which writes nothing when the revision is the commit itself.
