---
title: server/images.go at v0.40.10
url: https://github.com/ollama/ollama/blob/v0.40.10/server/images.go
created_at: 2026-11-24T12:41:47-03:00
updated_at: 2026-11-24T12:41:47-03:00
tool: docs/web/tools/ollama.md
---

# server/images.go at v0.40.10

What the repository relies on, in its own words: the file is about 55 KB, above what the repository holds in full (see the tool).

## Pulling a model's manifest

- **The request.** `pullModelManifest` asks `GET <host>/v2/<namespace>/<model>/manifests/<tag>` (the name's `BaseURL` and `DisplayNamespaceModel`, [types/model/name.go](types-model-name-go-at-v0-40-10.md)), accepting both `application/vnd.ollama.manifest.list.v2+json` and `application/vnd.docker.distribution.manifest.v2+json`, and parses the answer as a manifest.
- **A manifest list.** When the answer is a list, `PullModel` selects the child for its runner (`pullSelectedManifest`, [manifest/manifest.go](manifest-manifest-go-at-v0-40-10.md)), and fetches it as a blob; nested lists are refused. A plain manifest is used as it is.
- **The blobs.** Each layer is a blob at `<host>/v2/<namespace>/<model>/blobs/<digest>` (`remoteBlobLayer`), downloaded in parts with `Range` requests ([server/download.go](server-download-go-at-v0-40-10.md)).

## What each layer is

`modelFromManifest` reads a manifest's layers by media type:

| Media type | What it holds |
| --- | --- |
| `application/vnd.ollama.image.model` | The model's weights. The first is the model; any further one is a shard of it. A GGUF model's metadata is read from the first |
| `application/vnd.ollama.image.projector` | A vision projector, loaded with the model |
| `application/vnd.ollama.image.adapter` | A LoRA adapter |
| The draft model's type (`MediaTypeImageDraft`) | A speculative decoding draft model |
| `.template`, `.system`, `.params`, `.messages`, `.license`, `.prompt` | Small text or JSON layers |
