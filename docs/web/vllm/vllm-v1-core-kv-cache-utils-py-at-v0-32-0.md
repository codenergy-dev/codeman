---
title: vllm/v1/core/kv_cache_utils.py at v0.32.0
url: https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/v1/core/kv_cache_utils.py
created_at: 2026-10-30T21:13:26-03:00
updated_at: 2026-10-30T21:13:26-03:00
tool: docs/web/tools/vllm.md
---

# vllm/v1/core/kv_cache_utils.py at v0.32.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (112 KB). Each fact names the function it comes from.

## How the context is checked against memory

- `get_kv_cache_configs` sizes the K/V cache from the memory each GPU has left for it after the model and its activations were profiled (`available_memory`, set by `gpu_memory_utilization`), less one block that the block pool always holds back. It then checks, per GPU, that the cache can hold **one** request of `max_model_len` tokens (`_check_enough_kv_cache_memory`, unchanged since v0.31.0); `max_num_seqs` plays no part in the check.
- When it cannot, `_check_enough_kv_cache_memory` raises `ValueError` and the engine does not start: "To serve at least one request with the model's max seq len (N), (X GiB KV cache is needed, which is larger than the available KV cache memory (Y GiB). Based on the available memory, the estimated maximum model length is M. Try increasing `gpu_memory_utilization` … or decreasing `max_model_len` …". With no memory left at all: "No available memory for the cache blocks." vLLM never moves part of the model or the cache to the CPU on its own.

## Auto-fit

- With `max_model_len` set to `-1`, `get_kv_cache_configs` calls `_auto_fit_max_model_len`, which binary-searches (`_estimate_max_model_len_from_groups`) the largest `max_model_len` whose K/V cache for **one** request fits the available memory, up to the model's own context length.
- It logs "Auto-fit max_model_len: full model context length N fits in available KV cache memory (X GiB GPU)" or "Auto-fit max_model_len: reduced from N to M to fit in available KV cache memory (X GiB GPU)", and raises "Cannot auto-fit max_model_len: not enough GPU memory available to serve even a single token" when nothing fits.
- Since v0.31.0, the end of both lines changed: v0.31.0 said "fits in available GPU memory" and "to fit in available GPU memory (X GiB available for KV cache)". Their beginning, up to the numbers, is the same. The device is `GPU` on CUDA, else its type in capitals, such as `CPU`; with a host pool for sparse attention (`hisparse_config`), " + Y GiB host" follows.

## What it reports

- `get_kv_cache_capacity` computes how many requests of `max_model_len` tokens the cache holds at once (`get_max_concurrency_for_kv_cache_config`, aware of the cache's groups, such as a hybrid model's linear-attention state) and the cache's size in tokens: that concurrency times `max_model_len`.
- `update_kv_cache_capacity` stores both in the cache configuration (`kv_cache_size_tokens`, `kv_cache_max_concurrency`) and logs "GPU KV cache size: T tokens, Maximum concurrency for N tokens per request: C.CCx" (`GPU + host` with a host pool).
- When the cache holds fewer requests of that length than run at once, nothing fails here: the scheduler preempts requests and recomputes them later ([optimization and tuning](optimization-and-tuning.md#preemption)).
