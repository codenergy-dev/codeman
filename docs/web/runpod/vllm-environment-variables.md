---
title: vLLM environment variables
url: https://docs.runpod.io/serverless/vllm/environment-variables
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# vLLM environment variables

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Settings Codeman reads from the endpoint

- `MODEL_NAME`: the Hugging Face repository the worker serves ("LLM settings").
- `MAX_MODEL_LEN`: the context length the engine allocates for ("LLM settings").
- `OPENAI_SERVED_MODEL_NAME_OVERRIDE`: another name for the served model ("OpenAI compatibility settings").
- `ENABLE_AUTO_TOOL_CHOICE` (default `false`) and `TOOL_CALL_PARSER`: tool calling in chat completions, which needs a parser that matches the model ("OpenAI compatibility settings").
- `RAW_OPENAI_OUTPUT` (default `1`): OpenAI's stream format, required for compatibility ("Streaming and batch settings").
