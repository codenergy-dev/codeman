---
title: llm/llama_server.go at v0.40.10
url: https://github.com/ollama/ollama/blob/v0.40.10/llm/llama_server.go
created_at: 2026-10-30T21:13:26-03:00
updated_at: 2026-10-30T21:13:26-03:00
tool: docs/web/tools/ollama.md
---

# llm/llama_server.go at v0.40.10

What Codeman relies on, in its own words: the file is larger than the repository should hold (92 KB). Each fact names the function it comes from. Ollama 0.40.10 runs llama.cpp's `llama-server` at the version of [LLAMA_CPP_VERSION](llama-cpp-version-at-v0-40-10.md).

## How llama-server starts

- `startLlamaServer` always passes `-c` with the request's context length times the parallel requests (`NumCtx * numParallel`). So llama-server's context is never 0, and its fit never lowers it ([common/fit.h](../llama-cpp/common-fit-h-at-b11803.md)).
- It passes `-np` with the parallel requests, except for a decision model (one whose GGUF has `decision.type`), which gets `-np 16 --kv-unified --cache-ram 0` whatever the parallel requests. New since v0.35.1.
- It passes `--cache-type-k` and `--cache-type-v` with the K/V cache type when one is set.
- It passes no `-ngl` unless the model's options set `num_gpu`: llama-server decides how many layers go to the GPU, with its fit (the comment at the top of the file: "llama-server auto-detects GPU layers (-ngl)"). A context too large for the GPU then puts layers on the CPU rather than failing.
- `SetupLlamaServerCommandEnv` gives llama-server Ollama's whole environment, with Ollama's own variables on top.
- `extraEnvsForStart` adds the memory of a vision projector to `LLAMA_ARG_FIT_TARGET` (the fit's margin, in MiB), unless that variable is in Ollama's environment, which it then keeps as is.

## The batch's memory

- `LlamaServerBatch` gives the batch llama-server starts with and the memory the scheduler adds to its prediction for it. The batch is the options' `NumBatch`; for a decision model whose GGUF has `decision.block_count`, the whole context instead, capped at the trained one, since such a model reads its prompt without a K/V cache.
- The memory, from `LlamaServerBatchMemory`, is 0 below a batch of 1024, 768 MiB from 1024 and 2 GiB from 2048; none for a model without completion, unless it is such a decision model.
- Both replace v0.35.1's `DefaultEmbeddingNumBatchForContext` and `WithDefaultEmbeddingNumBatch`, and the surcharge `server/sched.go` computed itself.

## What it reports

- `ContextLength` is the request's context length (`NumCtx`).
- `MemorySize` gives the total and GPU memory parsed from llama-server's log of its buffers ("model buffer size", "KV buffer size", "compute buffer size", by device). When every layer is on the GPU, with none overflowing, the total is the GPU memory: `/api/ps` then shows `size` equal to `size_vram` (100% GPU). With layers on the CPU, `size` is larger. The function and the log's patterns are v0.35.1's.
- `PredictServerVRAM` estimates a load before it starts: the model file's size, plus a K/V cache of 2 (K and V) × layers × K/V heads × head size × context × 2 bytes (f16). Ollama calls it conservative.
