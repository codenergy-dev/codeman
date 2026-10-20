---
title: vllm/platforms/cpu.py at v0.31.0
url: https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/platforms/cpu.py
created_at: 2026-10-20T12:40:33-03:00
updated_at: 2026-10-20T12:40:33-03:00
tool: docs/web/tools/vllm.md
---

# vllm/platforms/cpu.py at v0.31.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (31 KB). Each fact names the class member it comes from. `CpuPlatform` is the platform vLLM selects when it is built for the CPU.

## Kernels by instruction set (`import_kernels`)

- On x86, vLLM loads one of three kernel libraries, by what the CPU supports at run time:
  - AVX-512 with BF16: `vllm._C`;
  - AVX-512 without BF16: `vllm._C_AVX512`;
  - otherwise: `vllm._C_AVX2`.
- So one build serves CPUs with AVX2 only, with the AVX2 library.

## Data types (`supported_dtypes`)

- On x86 and AArch64 Linux, the platform accepts `bfloat16`, `float16` and `float32`.

## Memory and the K/V cache (`get_device_total_memory`, `check_and_update_config`)

- The "device" memory is the memory node's total, from `get_memory_node_info` ([cpu_resource_utils.py](vllm-utils-cpu-resource-utils-py-at-v0-31-0.md)).
- When `VLLM_CPU_KVCACHE_SPACE` is set and not empty, its value in GiB becomes `cache_config.kv_cache_memory_bytes`: an explicit size for the K/V cache. The code calls it a legacy setting.
- Without it, the CPU worker sizes the cache from `gpu_memory_utilization` ([cpu_worker.py](vllm-v1-worker-cpu-worker-py-at-v0-31-0.md)).

## Other settings it changes (`check_and_update_config`)

- **Block size:** 128 tokens when the user gives none (16 for the MLA reference kernel, 256 for DeepSeek-V4). A size that is not a multiple of 32 logs a warning.
- **Cascade attention:** disabled.
- **Async scheduling:** always turned off ("async scheduling is not required on CPU").
- **Executor:** the multiprocessing executor (`mp`) replaces the single-process one, since OpenMP needs it; the worker class is `vllm.v1.worker.cpu_worker.CPUWorker`.
- **CUDA graphs:** no capture sizes.
- **Compilation:** in mode `VLLM_COMPILE`, the platform switches to `DYNAMO_TRACE_ONCE` with the `inductor` backend, or the `eager` backend when `VLLM_CPU_CI_ENV` is set, since compiling kernels takes time. (With `--enforce-eager`, `vllm/config/vllm.py` sets the mode to `NONE` instead.)
- **Libraries:** on Linux it adds PyTorch's `libgomp` and the bundled `libtcmalloc` to `LD_PRELOAD` when no OpenMP library is there already.

## NUMA (`discover_numa_topology`)

- It reads `/sys/devices/system/node` and `/sys/devices/system/cpu`; when either is missing, it finds no topology and returns an empty list.
