---
title: vllm/config/speculative.py at v0.31.0
url: https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/config/speculative.py
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/vllm.md
---

# vllm/config/speculative.py at v0.31.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (88 KB). It defines `SpeculativeConfig`, which `--speculative-config` fills from JSON; each fact names the type or field it comes from.

## Methods

`SpeculativeMethod` lists the values of `method`: `ngram`, `ngram_gpu`, `medusa`, `mlp_speculator`, `draft_model`, `suffix`, `custom_class`, `eagle`, `eagle3`, `extract_hidden_states`, `dflash`, `dspark`, and the MTP methods of `MTPModelTypes`: the generic `mtp` and model-specific ones such as `qwen3_5_mtp`, `qwen3_next_mtp` and `deepseek_mtp`.

## Fields

- `method`: one of the methods above.
- `num_speculative_tokens`: a whole number above 0, the tokens drafted per step. For MTP methods, the default comes from the model's configuration (such as `num_nextn_predict_layers`) when it has one.
- `model`: the draft model, for methods that use one, such as `draft_model`, `eagle3`, `dflash` and `dspark`.
- Others, such as `draft_tensor_parallel_size`, `quantization` and `enforce_eager`, tune the draft.
