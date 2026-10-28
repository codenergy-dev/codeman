---
title: unsloth/Qwen3.8-27B-NVFP4 at f0b7c9e
url: https://huggingface.co/unsloth/Qwen3.8-27B-NVFP4/tree/f0b7c9e722f5565102fff8481c99e4d86ae099c7
created_at: 2026-10-28T17:31:02-03:00
updated_at: 2026-10-28T17:31:02-03:00
tool: docs/web/tools/hugging-face.md
---

# unsloth/Qwen3.8-27B-NVFP4 at f0b7c9e

What the repository relies on, in its own words, from the Hub's model information at this commit and the model's small files (see the tool). The weights were not downloaded.

## Model information (`/api/models/unsloth/Qwen3.8-27B-NVFP4/revision/f0b7c9e…?blobs=true`)

- **`sha`:** `f0b7c9e722f5565102fff8481c99e4d86ae099c7`. On 2026-10-28 it was also the commit of `main`.
- **`private`:** false. **`gated`:** false. **`disabled`:** false.
- **`createdAt`:** 2026-08-13. **`lastModified`:** 2026-09-08.
- **`cardData.license`:** `apache-2.0`; `cardData.base_model` `Qwen/Qwen3.8-27B`. No `library_name` and no `pipeline_tag`.
- **`config`:** only `architectures`, `model_type`, `quantization_config`, `tokenizer_config` and `chat_template_jinja`; not `vision_config`, which only `config.json` has.
- **`siblings`:** two safetensors files, 23,417,592,488 bytes in all, and `config.json`, `preprocessor_config.json`, `video_preprocessor_config.json`, `generation_config.json`, `model.safetensors.index.json`, the tokenizer's files, `chat_template.jinja`, `README.md` and `.gitattributes`.

## Configuration (`config.json`)

- `https://huggingface.co/unsloth/Qwen3.8-27B-NVFP4/resolve/main/config.json` answers `307` to a cached copy at the commit (its `x-repo-commit` header), then `200`.
- `architectures` `Qwen3_5ForConditionalGeneration`, `model_type` `qwen3_5`.
- `vision_config`: an object, with `model_type` `qwen3_5_vision` and `depth` 27. With it, `image_token_id`, `video_token_id`, `vision_start_token_id` and `vision_end_token_id`.
- `language_model_only`: false.
- `text_config.max_position_embeddings`: 262144.
