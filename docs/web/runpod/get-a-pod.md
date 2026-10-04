---
title: Get a pod
url: https://docs.runpod.io/api-reference-v2/pods/get-a-pod
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Get a pod

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/pods/{id}`. `404` when the pod does not exist, which includes terminated pods ("OpenAPI").

## The pod

Fields Codeman reads (schema `Pod`):

- `id`, `name`, `image`, `env` (the environment it was created with) and `createdAt`.
- `status`: `PROVISIONING`, `STARTING`, `RUNNING`, `EXITED`, `ERROR` or `TERMINATED`.
- `gpu`: the GPU type `id` and `count`.
- `cost`: the current cost in USD per hour; `0` when `EXITED` or `TERMINATED`. The GPU type's list price is in [Get a GPU type](get-a-gpu-type.md); the rate actually billed for a pod is this field.
- `cloud`: `SECURE` or `COMMUNITY`.
