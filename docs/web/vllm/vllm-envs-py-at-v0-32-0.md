---
title: vllm/envs.py at v0.32.0
url: https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/envs.py
created_at: 2026-10-30T21:13:26-03:00
updated_at: 2026-10-30T21:13:26-03:00
tool: docs/web/tools/vllm.md
---

# vllm/envs.py at v0.32.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (119 KB). It lists every environment variable vLLM reads; each fact names the variable. Those below are v0.31.0's, with the same defaults, except the new one.

## Usage statistics

- `VLLM_USAGE_STATS_SERVER` defaults to `https://stats.vllm.ai`, where vLLM reports anonymous usage ([usage_lib.py](vllm-usage-usage-lib-py-at-v0-32-0.md)).
- `VLLM_NO_USAGE_STATS=1`, or `VLLM_DO_NOT_TRACK` (which also reads `DO_NOT_TRACK`), turns the report off.

## Caches

- `VLLM_CACHE_ROOT`: where vLLM keeps its caches, the `torch.compile` cache among them; `~/.cache/vllm` by default, or under `XDG_CACHE_HOME` when set.
- `VLLM_DISABLE_COMPILE_CACHE=1` turns the compilation cache off; `VLLM_FORCE_AOT_LOAD=1` makes a cache miss fail instead of compiling again ([optimization and tuning](optimization-and-tuning.md#faster-startup)).

## Other variables

- `VLLM_API_KEY`: the API key the server requires, like `--api-key`.
- `VLLM_ALLOW_LONG_MAX_MODEL_LEN`: allows a `max_model_len` above the model's own ([model.py](vllm-config-model-py-at-v0-32-0.md)).
- `VLLM_ENABLE_CUDA_COMPATIBILITY`: loads the image's CUDA forward-compatibility libraries, for hosts whose driver is older than the image's CUDA, on the GPUs NVIDIA supports for it ([installation](docs-getting-started-installation-gpu-cuda-inc-md-at-v0-32-0.md)). The official image sets it to `0`.
- `VLLM_LOGGING_LEVEL`: `INFO` by default.
- New: `VLLM_CHAT_TEMPLATE_RENDER_TIMEOUT`, 30 seconds by default: the time a chat template may take to render.
