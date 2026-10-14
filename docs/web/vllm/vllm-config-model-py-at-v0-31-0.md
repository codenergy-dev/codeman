---
title: vllm/config/model.py at v0.31.0
url: https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/config/model.py
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/vllm.md
---

# vllm/config/model.py at v0.31.0

What Codeman relies on, in its own words: the file is larger than the repository should hold (110 KB). Each fact names the field or function it comes from.

## The context length

- `ModelConfig.max_model_len` takes `-1` and up (`Field(default=None, ge=-1)`).
- `_get_and_verify_max_len`: without `max_model_len`, or with `-1`, the context is the one derived from the model's configuration (such as `max_position_embeddings`); with `-1`, the engine later lowers it to what fits the GPU (auto-fit, in [kv_cache_utils.py](vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md)). A `max_model_len` above the derived one is refused unless the model's `model_max_length` allows it (or `VLLM_ALLOW_LONG_MAX_MODEL_LEN` is set, [envs.py](vllm-envs-py-at-v0-31-0.md)).

## The compilation cache's key

- `ModelConfig.compute_hash` hashes every field that changes the compiled graph, and ignores a fixed list, among them `enforce_eager`, `served_model_name`, `hf_token`, `limit_mm_per_prompt` and `tokenizer`. `max_model_len` is not ignored: a different context length is a different key, so a restart with another context compiles again. With a multimodal model, `language_model_only` is part of the key too.

## Other fields

- `trust_remote_code` (default `False`): whether to run code from the model's repository.
- `enforce_eager` (default `False`): always run eagerly, without CUDA graphs.
- `served_model_name`: the names the API answers to; the model's own name when unset.
- `language_model_only` (default `False`): for a multimodal model, load and serve only its language model.
