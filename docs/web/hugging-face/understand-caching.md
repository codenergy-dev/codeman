---
title: Understand caching
url: https://huggingface.co/docs/huggingface_hub/v2.2.0/en/guides/manage-cache
created_at: 2026-10-21T11:22:04-03:00
updated_at: 2026-10-21T11:22:04-03:00
tool: docs/web/tools/hugging-face.md
---

# Understand caching

What the repository relies on, in its own words: the guide of `huggingface_hub` v2.2.0 is larger than the repository should hold (40 KB). Each fact names the section it comes from.

## The cache's directory ("File-based caching")

- The cache is `~/.cache/huggingface/hub` by default, or what `HF_HOME` or `HF_HUB_CACHE` names. With `HF_HOME`, it is its `hub/` directory.
- Each repository has its own directory in it, named after its type, its namespace when it has one, and its name, joined by `--`: `models--<namespace>--<name>`, such as `models--julien-c--EsperBERTo-small`.
- Each repository's directory holds `refs/`, `blobs/`, `snapshots/` and `trees/`.

## What each directory holds

- **`refs/`** ("Refs"): one file per reference fetched, such as `main`, holding the commit it pointed to.
- **`blobs/`** ("Blobs"): the files' contents, each named after its hash. In the guide's example ("In practice"), a large file's blob has a 64-character name and the small files' blobs 40-character names.
- **`snapshots/`** ("Snapshots"): one directory per revision downloaded, named after its commit, holding each downloaded file at its path in the repository, as a relative symbolic link to its blob, such as `README.md -> ../../blobs/<hash>`. A file shared by two revisions is one blob.
- **`trees/`** ("Trees"): `<commit>.json`, the commit's file list with each file's path, size and hash, written by `snapshot_download`.
- **`.no_exist/`** ("`.no_exist` (advanced)"): empty files, by revision, for files asked for that the Hub does not have.

## Exceptions to the layout

- Where symbolic links are not supported, or with `HF_HUB_DISABLE_SYMLINKS=1`, files are stored in `snapshots/` directly, without `blobs/` ("Limitations").
- A file downloaded through Xet may be stored once for every repository, at `<CACHE_DIR>/blobs/<prefix>/<xet_hash>`; the repository's `blobs/<etag>` is then itself a relative symbolic link to it, and the snapshot's layout is unchanged ("Shared blobs across repos").
