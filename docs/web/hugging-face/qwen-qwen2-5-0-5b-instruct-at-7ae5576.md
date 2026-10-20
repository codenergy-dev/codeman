---
title: Qwen/Qwen2.5-0.5B-Instruct at 7ae5576
url: https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/tree/7ae557604adf67be50417f59c2c2f167def9a775
created_at: 2026-10-20T19:06:41-03:00
updated_at: 2026-10-20T19:06:41-03:00
tool: docs/web/tools/hugging-face.md
---

# Qwen/Qwen2.5-0.5B-Instruct at 7ae5576

What the repository relies on, in its own words, from the Hub's model information at this commit and the model's small files (see the tool). The weights were not downloaded.

## Model information (`/api/models/Qwen/Qwen2.5-0.5B-Instruct/revision/7ae5576…?blobs=true`)

- **`sha`:** `7ae557604adf67be50417f59c2c2f167def9a775`. On 2026-10-20 it was also the commit of `main`.
- **`private`:** false. **`gated`:** false. **`disabled`:** false.
- **`createdAt`:** 2024-09-16. **`lastModified`:** 2024-09-25.
- **`cardData.license`:** `apache-2.0`; `cardData.base_model` `Qwen/Qwen2.5-0.5B`. `library_name` `transformers`, `pipeline_tag` `text-generation`.
- **`safetensors`:** 494,032,768 parameters, all `BF16`.
- **`siblings`:** one weights file, `model.safetensors`, 988,097,824 bytes, `lfs.sha256` `fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe`. The other files are `config.json`, `generation_config.json`, the tokenizer's files (`tokenizer.json`, `tokenizer_config.json`, `vocab.json`, `merges.txt`), `README.md`, `LICENSE` (11,343 bytes) and `.gitattributes`.

## Configuration (`config.json`)

- `architectures` `Qwen2ForCausalLM`, `model_type` `qwen2`, `torch_dtype` `bfloat16`.
- `max_position_embeddings` 32768; `use_sliding_window` false.
- `num_hidden_layers` 24, `num_attention_heads` 14, `num_key_value_heads` 2, `hidden_size` 896, so a head size of 64.

## Chat template (`tokenizer_config.json`, `chat_template`)

- It lists tools inside `<tools></tools>`, and writes calls inside `<tool_call></tool_call>` and results inside `<tool_response></tool_response>`: the Hermes format.

## License (`LICENSE`)

- The Apache License, Version 2.0.
