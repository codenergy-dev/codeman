---
title: server/routes.go at v0.40.10
url: https://github.com/ollama/ollama/blob/v0.40.10/server/routes.go
created_at: 2026-10-30T21:13:26-03:00
updated_at: 2026-10-30T21:13:26-03:00
tool: docs/web/tools/ollama.md
---

# server/routes.go at v0.40.10

What Codeman relies on, in its own words: the file is larger than the repository should hold (108 KB). Each fact names the function it comes from; those of other files name the file.

## The default context length

- `Serve` sets the default context length once, at the server's start, from the total memory of the GPUs it found, each less `OLLAMA_GPU_OVERHEAD`: 262144 tokens from 47 GiB, 32768 from 23 GiB, else 4096. It logs "vram-based default context". The tiers do not depend on the model, nor on `OLLAMA_NUM_PARALLEL`.
- `modelOptionsWithEmbeddingBatchDefault` uses that default only when the options' `NumCtx` is 0, which it is when `OLLAMA_CONTEXT_LENGTH` is unset (`DefaultOptions` reads it, in `api/types.go`); a model's or a request's `num_ctx` replaces either.
- `usesAutomaticNumCtx` says the context is automatic only when neither the request, nor the model, nor `OLLAMA_CONTEXT_LENGTH` sets it.

## Routes

- `GET /api/ps` (`PsHandler`) lists the loaded models with `name`, `model`, `size`, `size_vram`, `digest`, `details`, `expires_at`, `context_length` and, new since v0.35.1, `runner` ([list running models](list-running-models.md)). Its `digest` is the model's selected manifest (`ManifestDigest`), else its manifest: for a manifest list, the child that serves it.
- `GET /api/tags` (`ListHandler`, with `listModels` in `server/model_list.go`) gives one row per model, whose `digest` is its manifest's; for a manifest list, the selected child's, the same digest `/api/ps` reports.
- `POST /api/show` (`GetModelInfo`) reports `details.family` as the model's family (`Config.ModelFamily`) for GGUF models, and its `capabilities`. New since v0.35.1, it also reports the model's `runner`, its `renderer`, `parser` and `template_source`, and `manifests`, a summary of a manifest list's children. Its `model_info` leaves out values JSON cannot hold, such as NaN (`jsonSafeValues`, in `server/gguf_metadata.go`).
- No route reports the GPUs or their memory.

## Models downloaded by an earlier version

`scheduleRunnerForModel` holds the background upgrade of `ggml` models to llama.cpp (`compatmigrate.StartLocalCompatibilityMigration`) commented out, behind "TODO: enable compatibility migration": at this tag, loading a model never rewrites it.
