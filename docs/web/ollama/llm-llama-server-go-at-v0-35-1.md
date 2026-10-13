---
title: llm/llama_server.go at v0.35.1
url: https://github.com/ollama/ollama/blob/v0.35.1/llm/llama_server.go
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
tool: docs/web/tools/ollama.md
---

# llm/llama_server.go at v0.35.1

What Codeman relies on, in its own words: the file is larger than the repository should hold (90 KB). Each fact names the function it comes from. Ollama 0.35.1 runs llama.cpp's `llama-server` at the version of [LLAMA_CPP_VERSION](llama-cpp-version-at-v0-35-1.md).

## How llama-server starts

- `startLlamaServer` always passes `-c` with the request's context length times the parallel requests (`NumCtx * numParallel`), and `-np` with the parallel requests. So llama-server's context is never 0, and its fit never lowers it ([common/fit.h](../llama-cpp/common-fit-h-at-b11232.md)).
- It passes `--cache-type-k` and `--cache-type-v` with the K/V cache type when one is set.
- It passes no `-ngl` unless the model's options set `num_gpu`: llama-server decides how many layers go to the GPU, with its fit (the comment at the top of the file: "llama-server auto-detects GPU layers (-ngl)"). A context too large for the GPU then puts layers on the CPU rather than failing.
- `SetupLlamaServerCommandEnv` gives llama-server Ollama's whole environment, with Ollama's own variables on top.
- `extraEnvsForStart` adds the memory of a vision projector to `LLAMA_ARG_FIT_TARGET` (the fit's margin, in MiB), unless that variable is in Ollama's environment, which it then keeps as is.

## What it reports

- `ContextLength` is the request's context length (`NumCtx`).
- `MemorySize` gives the total and GPU memory parsed from llama-server's log of its buffers ("model buffer size", "KV buffer size", "compute buffer size", by device). When every layer is on the GPU, with none overflowing, the total is the GPU memory: `/api/ps` then shows `size` equal to `size_vram` (100% GPU). With layers on the CPU, `size` is larger.
- `PredictServerVRAM` estimates a load before it starts: the model file's size, plus a K/V cache of 2 (K and V) × layers × K/V heads × head size × context × 2 bytes (f16). Ollama calls it conservative.
