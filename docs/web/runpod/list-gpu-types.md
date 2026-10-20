---
title: List GPU types
url: https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types
created_at: 2026-10-20T15:11:00-03:00
updated_at: 2026-10-20T15:11:00-03:00
tool: docs/web/tools/runpod.md
---

# List GPU types

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/catalog/gpus` ("OpenAPI", operation `listGpuTypes`). It takes the same optional filters as [Get a GPU type](get-a-gpu-type.md): `include=AVAILABILITY` with `product`, `count`, `cloud`, `cudaVersions` and `minCudaVersion`, plus `countryCodes`, which narrows the list to GPU types deployable in those countries. It is not paginated.

## Response

`{"gpus": [...]}` (schema `ListGpuTypesResponse`), each item a `GpuType` as in [Get a GPU type](get-a-gpu-type.md): `id`, `name`, `pool` (the Serverless GPU pool, or null), `manufacturer`, `memory`, `secure`, `community`, `price` (`secure`, `community` and, for a pool the caller can use, `serverless`, in USD per hour for one GPU) and `maxCount` (`secure`, `community`: the largest GPU count of one pod, not stock). With `include=AVAILABILITY`, `availability` and `dataCenters` too ("OpenAPI", the response's example).
