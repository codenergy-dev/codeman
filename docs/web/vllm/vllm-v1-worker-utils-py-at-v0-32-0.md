---
title: vllm/v1/worker/utils.py at v0.32.0
url: https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/v1/worker/utils.py
created_at: 2026-11-24T12:38:49-03:00
updated_at: 2026-11-24T12:38:49-03:00
tool: docs/web/tools/vllm.md
---

# vllm/v1/worker/utils.py at v0.32.0

What the repository relies on, in its own words: the file is about 41 KB, above what the repository holds in full (see the tool).

## `request_memory`

- It returns the memory the engine may use: `ceil(total_memory × gpu_memory_utilization)`, from the snapshot the worker takes at its start ([gpu_worker.py](vllm-v1-worker-gpu-worker-py-at-v0-32-0.md)).
- With weights held by another process (`external_weight_memory`), it fails when they exceed that budget, or when the free memory is below the rest; Codeman's pods load their weights in vLLM's own process, so this does not apply.
- The default `gpu_memory_utilization` is 0.92 (`CacheConfig`, [vllm/config/cache.py](vllm-config-cache-py-at-v0-32-0.md)).
