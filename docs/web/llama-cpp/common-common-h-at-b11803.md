---
title: common/common.h at b11803
url: https://github.com/ggml-org/llama.cpp/blob/b11803/common/common.h
created_at: 2026-10-30T21:13:26-03:00
updated_at: 2026-10-30T21:13:26-03:00
tool: docs/web/tools/llama-cpp.md
---

# common/common.h at b11803

What Codeman relies on, in its own words: the file is larger than the repository should hold (58 KB). The defaults of the fit's parameters, in `struct common_params`, are b11232's:

- `fit_params`: true. llama-server fits unset parameters to the devices' free memory.
- `fit_params_target`: 1024 MiB for every device. The fit leaves at least this much of each device's memory free, as it projects it.
- `fit_params_min_ctx`: 4096. The least context the fit sets when it lowers an unset context.

Other defaults that changed since b11232, none of which Ollama's start relies on:

- `port`: 9931, against 8080. Ollama always passes `--port`.
- `endpoint_slots`: still true, so llama-server serves `/slots`.
- New: `load_mtp` (false), `moe_cache_size` (0), `cache_ram_explicit` (set by `--cache-ram`), and the decision model types (`common_decision_type`).
