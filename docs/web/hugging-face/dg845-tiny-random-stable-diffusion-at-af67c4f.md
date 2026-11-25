---
title: dg845/tiny-random-stable-diffusion at af67c4f
url: https://huggingface.co/dg845/tiny-random-stable-diffusion/tree/af67c4fb4c7a3153cbabb98a478207e792628eb2
created_at: 2026-10-30T11:40:01-03:00
updated_at: 2026-10-30T11:40:01-03:00
tool: docs/web/tools/hugging-face.md
---

# dg845/tiny-random-stable-diffusion at af67c4f

A Stable Diffusion pipeline with tiny, random weights, which the multi-service pods experiment serves on CPU as a stand-in for an image generator. Its images are noise. In the experiment's own words.

## The model

From `GET /api/models/dg845/tiny-random-stable-diffusion/revision/af67c4fb4c7a3153cbabb98a478207e792628eb2?blobs=true`:

| Field | Value |
| --- | --- |
| `sha` | `af67c4fb4c7a3153cbabb98a478207e792628eb2` |
| `lastModified` | 2023-10-29T05:51:21Z |
| `private`, `gated` | `false`, `false` |
| `cardData.license` | `apache-2.0`; the repository has no `LICENSE` file |

## Files

From `siblings`: weights only as safetensors, no pickled files.

| File | Size (bytes) | `lfs.sha256` |
| --- | --- | --- |
| `text_encoder/model.safetensors` | 246416 | `5edffee1c2ae276b4ecf6e6fc290c2da8224cda3a5a57d1d86a468e8d7e70b62` |
| `unet/diffusion_pytorch_model.safetensors` | 96000 | `8f2a2ce8d55801238ff2bb5280338ed494b8256a5208af6e70ec39cf38625d46` |
| `vae/diffusion_pytorch_model.safetensors` | 59772 | `b023ca2edc02c318f3c46b7c8c05d21c188724d40b51855065fec0f91bf950ef` |

The other files are small JSON and text: `model_index.json`, the scheduler's, text encoder's, UNet's and VAE's `config.json`, and the tokenizer's files.

## The pipeline

- `model_index.json`: `_class_name` `StableDiffusionPipeline`, scheduler `DDPMScheduler`, text encoder `transformers` `CLIPTextModel`, tokenizer `CLIPTokenizer`; `safety_checker` and `feature_extractor` are null; written by diffusers `0.22.0.dev0`.
- `unet/config.json`: `sample_size` 32, `block_out_channels` `[4, 8]`.
