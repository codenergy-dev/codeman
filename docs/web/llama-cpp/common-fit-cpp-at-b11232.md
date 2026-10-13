---
title: common/fit.cpp at b11232
url: https://github.com/ggml-org/llama.cpp/blob/b11232/common/fit.cpp
created_at: 2026-10-13T13:24:22-03:00
updated_at: 2026-10-13T13:24:22-03:00
tool: docs/web/tools/llama-cpp.md
---

# common/fit.cpp at b11232

What Codeman relies on, in its own words: the file is larger than the repository should hold (52 KB). Each fact names the function it comes from; the contract is in [common/fit.h](common-fit-h-at-b11232.md).

- `common_params_fit_impl` first measures the memory each device would use with the given parameters, and changes nothing when the free memory left on each device is at least its margin ("no changes needed").
- Otherwise it lowers the context only when the context is unset (`n_ctx` 0, "`n_ctx_auto`"), down to the minimum context, by interpolating between the memory at the maximum and at the minimum context. A context the caller set is kept: "context size set by user to … -> no change".
- Then, when the GPU layers are at their default, it lowers how many layers go to the GPU until the margin holds, putting the rest on the CPU. Layers set by the caller (`n_gpu_layers`) stop the fit instead.
- The memory of a second model on the same devices, such as a draft or MTP model, is measured with the main model's context and added (`common_fit_extra_model`).
