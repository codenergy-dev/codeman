---
title: vllm/v1/worker/gpu_worker.py at v0.32.0
url: https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/v1/worker/gpu_worker.py
created_at: 2026-11-24T12:38:49-03:00
updated_at: 2026-11-24T12:38:49-03:00
tool: docs/web/tools/vllm.md
---

# vllm/v1/worker/gpu_worker.py at v0.32.0

What the repository relies on, in its own words: the file is about 71 KB, above what the repository holds in full (see the tool).

## How the K/V cache's memory is found

- **The budget.** When the worker initializes its CUDA device, it takes a snapshot of the GPU's memory (`MemorySnapshot`) and sets `requested_memory` with `request_memory` ([vllm/v1/worker/utils.py](vllm-v1-worker-utils-py-at-v0-32-0.md)): the GPU's total memory times `gpu_memory_utilization` (`init_device`).
- **The profile.** `determine_available_memory` runs a forward pass with dummy inputs inside `memory_profiling` ([vllm/utils/mem_utils.py](vllm-utils-mem-utils-py-at-v0-32-0.md)), given the weights' memory (`model_memory_usage`). The result's `non_kv_cache_memory` is everything the engine consumed, weights included, plus the transient peak of the pass.
- **CUDA graphs.** When graphs are captured, it also estimates their memory (`profile_cudagraph_memory`), and subtracts it only when `VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS` is set.
- **The K/V cache's share.** `available_kv_cache_memory_bytes = requested_memory − non_kv_cache_memory` (− the CUDA graphs' estimate, when applied), logged as "Available KV cache memory: … GiB".
- **An explicit size.** With `kv_cache_memory_bytes` set, the profile still runs, but the cache gets that size, and `gpu_memory_utilization` is not respected.

So the K/V cache gets at most the GPU's total memory times `gpu_memory_utilization`, less the weights: the activations, the CUDA context and other non-PyTorch memory only lower it.
