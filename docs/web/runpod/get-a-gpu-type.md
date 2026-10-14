---
title: Get a GPU type
url: https://docs.runpod.io/api-reference-v2/catalog/get-a-gpu-type
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-13T21:31:58-03:00
tool: docs/web/tools/runpod.md
---

# Get a GPU type

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/catalog/gpus/{id}`, where `{id}` is a GPU type ID such as `NVIDIA GeForce RTX 4090` ("OpenAPI"). A GPU type that does not exist answers `404`.

Query parameters, all optional ("OpenAPI", `parameters`):

- `include=AVAILABILITY` adds the availability fields below. It requires `product` (`POD`, `CLUSTER` or `SERVERLESS`, with no default, since stock differs by product), and `product` is valid only with it: `400` either way.
- `cloud`: `SECURE` (the default) or `COMMUNITY`; `count`: the GPUs per pod, 1 by default. Valid only with `include=AVAILABILITY`.
- `minCudaVersion`: the lowest acceptable CUDA version, compared numerically, as `major` or `major.minor`, such as `13.0`. `cudaVersions`: an exact set, such as `12.8,12.6`. Each is valid only with `include=AVAILABILITY`, and they are mutually exclusive (`400`); a malformed value is `422`. Both scope the availability, the prices and the returned `cudaVersions`.

## Response

Fields Codeman reads (schema `GpuType`):

- `id`, `name`, `memory` (VRAM in GB) and `secure` (whether Secure Cloud offers it).
- `pool`: the Serverless GPU pool it belongs to, or null.
- `price`: list prices in USD per hour for one GPU: `secure` and `community` for pods, and `serverless` for the GPU's pool (absent when the caller cannot use the pool). Multiply by the GPU count. Negotiated discounts are not reflected; a pod's billed rate is its `cost`.

With `include=AVAILABILITY` only:

- `availability`: `NONE`, `LOW`, `MEDIUM` or `HIGH`, for the requested product, cloud, count and CUDA filter; `dataCenters`, the same per data center that offers the GPU.
- `cudaVersions`: the CUDA versions that machines with this GPU type offer, scoped by the same filters, each with `version` (`major.minor`, usable for a pod's `gpu.allowedCudaVersions`) and `available`: `true` when at least one machine on that version has free capacity now; `false` when the version is offered but full, so a pod constrained to it fails on capacity. Machines that report no CUDA version are skipped, and the field is absent when none does: treat a missing `cudaVersions` as an empty one. A version absent from the list is not offered for this GPU type ("`cudaVersions`", schema `CudaVersionAvailability`).
