---
title: OpenAI API compatibility
url: https://docs.runpod.io/serverless/vllm/openai-compatibility
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# OpenAI API compatibility

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Base URL and key

A vLLM worker serves an OpenAI-compatible API at `https://api.runpod.ai/v2/<endpoint-id>/openai/v1`, authenticated with a Runpod API key ("Setup"). It supports `/chat/completions`, `/completions` and `/models` ("Supported endpoints"), streamed or not ("Chat completions").

## Model name

`model` must be the Hugging Face model the worker serves (`MODEL_NAME`), or the name set in `OPENAI_SERVED_MODEL_NAME_OVERRIDE` ("Model name").

## Differences

Token counts may differ from other tokenizers, and tool calling depends on the model and on vLLM ("Differences from OpenAI"). The page does not say whether `usage` is returned, or whether `stream_options.include_usage` is honored.
