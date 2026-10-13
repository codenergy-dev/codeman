---
title: server/sched.go at v0.35.1
url: https://github.com/ollama/ollama/blob/v0.35.1/server/sched.go
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
tool: docs/web/tools/ollama.md
---

# server/sched.go at v0.35.1

What Codeman relies on, in its own words: the file is larger than the repository should hold (59 KB). Each fact names the function it comes from.

## Parallel requests

- `load` takes the number of parallel requests from `OLLAMA_NUM_PARALLEL` (at least 1), and sets it to 1 for models without the completion capability (embeddings).
- `load` also sets it to 1, with the warning "model architecture does not currently support parallel requests", when the model's family (`Config.ModelFamily`, which `/api/show` and `/api/ps` report as `details.family`) is one of `mllama`, `qwen3vl`, `qwen3vlmoe`, `qwen35`, `qwen35moe`, `qwen3next`, `lfm2`, `lfm2moe`, `nemotron_h`, `nemotron_h_moe` or `nemotron_h_omni`. Such a model serves one request at a time, whatever `OLLAMA_NUM_PARALLEL` says; the others wait.

## Loading

- `processPending` loads the first model with `requireFull` false: nothing requires it to fit the GPU whole. With other models loaded, `load` evicts them when its prediction (`PredictServerVRAM`, in [llm/llama_server.go](llm-llama-server-go-at-v0-35-1.md)) exceeds 80% of the free memory.
- `load` starts llama-server with the request's context length (`NumCtx`) and the number of parallel requests; llama-server decides the GPU layers itself.
- When llama-server fails to load for lack of memory, `reduceAutoNumCtxForLoadOOM` retries once with a smaller context, only when the context is Ollama's automatic one (no `OLLAMA_CONTEXT_LENGTH`, no `num_ctx` in the request or the model): from above 32768 to 32768, from above 4096 to 4096 (`nextLowerAutoNumCtx`). A context set by `OLLAMA_CONTEXT_LENGTH` is never lowered.
- `effectiveContext` caps a context at the model's trained context length (`<arch>.context_length`) for Ollama's memory predictions.

## What `/api/ps` reports

`loadedModels` gives each loaded model's `size` and `size_vram` from the runner's `MemorySize` (total and GPU memory, in bytes, from llama-server's log of its buffers), and its `context_length` from the runner's `ContextLength`: the context of one request (`NumCtx`), not multiplied by the parallel requests.
