---
title: common/common.h at b11232
url: https://github.com/ggml-org/llama.cpp/blob/b11232/common/common.h
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
tool: docs/web/tools/llama-cpp.md
---

# common/common.h at b11232

What Codeman relies on, in its own words: the file is larger than the repository should hold (52 KB). The defaults of the fit's parameters, in `struct common_params`:

- `fit_params`: true. llama-server fits unset parameters to the devices' free memory.
- `fit_params_target`: 1024 MiB for every device. The fit leaves at least this much of each device's memory free, as it projects it.
- `fit_params_min_ctx`: 4096. The least context the fit sets when it lowers an unset context.
