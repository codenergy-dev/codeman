---
title: vllm/v1/metrics/loggers.py at v0.31.0
url: https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/v1/metrics/loggers.py
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/vllm.md
---

# vllm/v1/metrics/loggers.py at v0.31.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (53 KB). Each fact names the method it comes from.

## The cache's configuration as a metric

- Once the engine has started, `PrometheusStatLogger.log_engine_initialized` publishes the cache's configuration on the server's Prometheus endpoint (`/metrics`) as the gauge `vllm:cache_config_info`, permanently `1`, whose labels are every field of `CacheConfig` as text (`log_metrics_info`, with `CacheConfig.metrics_info` in [cache.py](vllm-config-cache-py-at-v0-31-0.md)), plus `engine`.
- Among those labels are `num_gpu_blocks`, `block_size`, `cache_dtype`, `gpu_memory_utilization`, and the capacity the engine computed at start: `kv_cache_size_tokens` and `kv_cache_max_concurrency` (`update_kv_cache_capacity` in [kv_cache_utils.py](vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md)), which the engine's process gives the server's.
