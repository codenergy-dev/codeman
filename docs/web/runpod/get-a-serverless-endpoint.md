---
title: Get a serverless endpoint
url: https://docs.runpod.io/api-reference-v2/serverless/get-a-serverless-endpoint
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Get a serverless endpoint

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/serverless/{id}` ("OpenAPI").

## The endpoint

Fields Codeman reads (schema `Endpoint`):

- `type`: `QUEUE` or `LOAD_BALANCER`.
- `workers`: `min` (active workers, always on), `max`, and `idleTimeout`, in seconds.
- `gpu`: `pools` (Serverless GPU pool IDs, as `pool` in [Get a GPU type](get-a-gpu-type.md)), `excludedTypes` and `count` (GPUs per worker).
- `env`: the workers' environment, which holds the vLLM worker's settings; see [vLLM environment variables](vllm-environment-variables.md).
- `flashboot`: `OFF`, `FLASHBOOT` or `PRIORITY_FLASHBOOT`.

The schema has no cloud field: unlike a pod, an endpoint does not say whether it runs on Secure Cloud.
