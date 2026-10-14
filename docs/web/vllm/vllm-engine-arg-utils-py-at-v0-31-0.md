---
title: vllm/engine/arg_utils.py at v0.31.0
url: https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/engine/arg_utils.py
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/vllm.md
---

# vllm/engine/arg_utils.py at v0.31.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (136 KB). It defines the engine arguments of `vllm serve`, which the "Engine Arguments" page lists; each fact names the argument or function it comes from. The server's own arguments (host, port, API key, tool calling) are in [cli_args.py](vllm-entrypoints-launchers-cli-args-py-at-v0-31-0.md), and the cache's in [cache.py](vllm-config-cache-py-at-v0-31-0.md).

## How arguments are written

- `EngineArgs.add_cli_args` makes one `--kebab-case` flag per field. A boolean field takes `--flag` and `--no-flag` (`argparse.BooleanOptionalAction`, in `_compute_kwargs`); a field of type `dict`, such as `speculative_config`, takes JSON.
- `--max-model-len` takes a whole number, a human-readable one such as `128k`, or `-1` or `auto` for auto-fit (`human_readable_int_or_auto`, set in `_compute_kwargs`).

## Arguments Codeman relies on

| Argument | Field | Default |
| --- | --- | --- |
| `--max-model-len` | `ModelConfig.max_model_len` | The model's own ([model.py](vllm-config-model-py-at-v0-31-0.md)) |
| `--max-num-seqs` | `SchedulerConfig.max_num_seqs` | By the GPU's memory, in `get_batch_defaults`: 1024 from 70 GiB (but A100), 256 below |
| `--max-num-batched-tokens` | `SchedulerConfig.max_num_batched_tokens` | For the API server, by the GPU's memory, in `get_batch_defaults`: 16384 from 160 GiB, 8192 from 70 GiB (but A100), 2048 below |
| `--gpu-memory-utilization` | `CacheConfig.gpu_memory_utilization` | 0.92 |
| `--kv-cache-dtype` | `CacheConfig.cache_dtype` | `auto` |
| `--enable-prefix-caching` | `CacheConfig.enable_prefix_caching` | On |
| `--enable-chunked-prefill` | `SchedulerConfig.enable_chunked_prefill` | On |
| `--async-scheduling` | `SchedulerConfig.async_scheduling` | Decided by vLLM |
| `--speculative-config` | `speculative_config` | None; JSON such as `{"method":"mtp","num_speculative_tokens":3}` |
| `--enforce-eager` | `ModelConfig.enforce_eager` | Off |
| `--optimization-level` | `VllmConfig.optimization_level` | 2 ([optimization levels](optimization-levels.md)) |
| `--language-model-only` | `language_model_only` | Off |
| `--served-model-name` | `ModelConfig.served_model_name` | The model's name |
| `--trust-remote-code` | `ModelConfig.trust_remote_code` | Off |
| `--tensor-parallel-size` | `ParallelConfig.tensor_parallel_size` | 1 |

## Arguments that move weights, cache or requests elsewhere

- `--cpu-offload-gb` (`UVAOffloadConfig.cpu_offload_gb`) and `--kv-offloading-size` with `--kv-offloading-backend` put weights or K/V cache in CPU memory.
- `--kv-transfer-config` and `--kv-events-config` send K/V cache or its events to other processes or hosts; `--otlp-traces-endpoint` sends traces to an OpenTelemetry collector.
- `--enable-log-requests` writes requests to the log.
- `--download-dir`, `--load-format` and `--hf-token` decide where and how the weights are fetched.
