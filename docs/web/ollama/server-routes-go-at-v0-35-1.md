---
title: server/routes.go at v0.35.1
url: https://github.com/ollama/ollama/blob/v0.35.1/server/routes.go
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
tool: docs/web/tools/ollama.md
---

# server/routes.go at v0.35.1

What Codeman relies on, in its own words: the file is larger than the repository should hold (94 KB). Each fact names the function it comes from.

## The default context length

- `Serve` sets the default context length once, at the server's start, from the total memory of the GPUs it found, each less `OLLAMA_GPU_OVERHEAD`: 262144 tokens from 47 GiB, 32768 from 23 GiB, else 4096. It logs "vram-based default context". The tiers do not depend on the model, nor on `OLLAMA_NUM_PARALLEL`.
- `modelOptionsWithEmbeddingBatchDefault` uses that default only when the options' `NumCtx` is 0, which it is when `OLLAMA_CONTEXT_LENGTH` is unset (`DefaultOptions` reads it, in `api/types.go`); a model's or a request's `num_ctx` replaces either.
- `usesAutomaticNumCtx` says the context is automatic only when neither the request, nor the model, nor `OLLAMA_CONTEXT_LENGTH` sets it.

## Routes

- `GET /api/ps` (`PsHandler`) lists the loaded models with `name`, `model`, `size`, `size_vram`, `digest`, `details`, `expires_at` and `context_length` ([list running models](list-running-models.md)).
- `POST /api/show` (`GetModelInfo`) reports `details.family` as the model's family (`Config.ModelFamily`) for GGUF models.
- No route reports the GPUs or their memory.
