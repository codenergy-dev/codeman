---
title: common/arg.cpp at b11232
url: https://github.com/ggml-org/llama.cpp/blob/b11232/common/arg.cpp
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
tool: docs/web/tools/llama-cpp.md
---

# common/arg.cpp at b11232

What Codeman relies on, in its own words: the file is larger than the repository should hold (221 KB). Each fact names the option it comes from, with its environment variable.

| Option | Variable | What it does |
| --- | --- | --- |
| `-c`, `--ctx-size` | `LLAMA_ARG_CTX_SIZE` | The context size; 0 loads it from the model, and then also keeps the fit from lowering it |
| `-np`, `--parallel` | `LLAMA_ARG_N_PARALLEL` | The number of server slots: requests served at once, each with its share of the context |
| `-fit`, `--fit` | `LLAMA_ARG_FIT` | "Whether to adjust unset arguments to fit in device memory", `on` by default |
| `-fitt`, `--fit-target` | `LLAMA_ARG_FIT_TARGET` | The fit's margin of free memory per device, in MiB; one value applies to every device |
| `-fitc`, `--fit-ctx` | `LLAMA_ARG_FIT_CTX` | The least context the fit may set when it lowers an unset context |

A command-line option replaces its variable ("will be overwritten by command line argument"), so Ollama's `-c` wins over any `LLAMA_ARG_CTX_SIZE`. The defaults are in [common/common.h](common-common-h-at-b11232.md).
