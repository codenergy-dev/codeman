---
title: Get a GPU type
url: https://docs.runpod.io/api-reference-v2/catalog/get-a-gpu-type
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Get a GPU type

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/catalog/gpus/{id}`, where `{id}` is a GPU type ID such as `NVIDIA GeForce RTX 4090` ("OpenAPI").

## Response

Fields Codeman reads (schema `GpuType`):

- `id`, `name`, `memory` (VRAM in GB) and `secure` (whether Secure Cloud offers it).
- `pool`: the Serverless GPU pool it belongs to, or null.
- `price`: list prices in USD per hour for one GPU: `secure` and `community` for pods, and `serverless` for the GPU's pool (absent when the caller cannot use the pool). Multiply by the GPU count. Negotiated discounts are not reflected; a pod's billed rate is its `cost`.
