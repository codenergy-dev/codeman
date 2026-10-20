---
title: "qwen2.5:0.5b"
url: https://ollama.com/library/qwen2.5:0.5b
created_at: 2026-10-20T19:06:41-03:00
updated_at: 2026-10-20T19:06:41-03:00
tool: docs/web/tools/ollama.md
---

# qwen2.5:0.5b

What the repository relies on, in its own words, from the model's manifest in Ollama's registry and its small layers (see the tool). The weights were not downloaded.

## Manifest

- **Source:** `https://registry.ollama.ai/v2/library/qwen2.5/manifests/0.5b`, `mediaType` `application/vnd.docker.distribution.manifest.v2+json`.
- **Digest:** the manifest's bytes hash to `sha256:a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`, the digest Ollama's `/api/tags` reports for the model. The tag can be re-pushed; the digest cannot change.
- **Layers (`layers`):**

  | `mediaType` | Digest | Size in bytes |
  | --- | --- | --- |
  | `application/vnd.ollama.image.model` | `sha256:c5396e06af294bd101b30dce59131a76d2b773e76950acc870eda801d3ab0515` | 397,807,936 |
  | `application/vnd.ollama.image.system` | `sha256:66b9ea09bd5b7099cbb4fc820f31b575c0366fa439b08245566692c6784e281e` | 68 |
  | `application/vnd.ollama.image.template` | `sha256:eb4402837c7829a690fa845de4d7f3fd842c2adee476d5341da8a46ea9255175` | 1,482 |
  | `application/vnd.ollama.image.license` | `sha256:832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e` | 11,343 |

## Configuration (`config`, `sha256:005f95c7…`)

- `model_format` `gguf`, `model_family` `qwen2`, `model_type` `494.03M` (parameters), `file_type` `Q4_K_M`.

## Template and system prompt

- **Tools:** the template renders `.Tools` inside `<tools></tools>` in the system message, asks for each call as JSON inside `<tool_call></tool_call>`, renders an assistant's `.ToolCalls` the same way, and a `tool` message as `<tool_response>` in a user turn: Hermes style.
- **Chat format:** ChatML turns, `<|im_start|>` and `<|im_end|>`.
- **System prompt layer:** a default system prompt naming the model Qwen, by Alibaba Cloud.

## License

- The license layer is the Apache License, Version 2.0. It is the same size, 11,343 bytes, as the `LICENSE` file of [`Qwen/Qwen2.5-0.5B-Instruct`](../hugging-face/qwen-qwen2-5-0-5b-instruct-at-7ae5576.md).
