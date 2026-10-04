---
title: Create a pod
url: https://docs.runpod.io/api-reference-v2/pods/create-a-pod
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Create a pod

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`POST /v2/pods`, with a `CreatePodRequest` body ("OpenAPI"; the schema is in the OpenAPI document):

- `name` (required) and `image` (required unless a template is given).
- `gpu`: `id` (a GPU type ID, such as `NVIDIA GeForce RTX 4090`) and `count` (default 1). A pod takes exactly one of `gpu` or `cpu`.
- `cloud`: `SECURE` (the default) or `COMMUNITY`.
- `env`: environment variables, as an object.
- `ports`: exposed ports, each as `port/protocol`, such as `8080/http`.
- `disk`: container disk in GB, ephemeral.
- `mounts.persistent`: optional host-local persistent storage; omitted, the pod has none.

The call places one specific GPU type: it does not search for capacity or fall back to another GPU.

## Response

`201` with the pod, as in [Get a pod](get-a-pod.md). Provisioning is asynchronous: the pod starts in `PROVISIONING`, goes through `STARTING` and reaches `RUNNING` once its container is healthy; poll the pod rather than assume it runs. A body above 102,400 bytes is refused with `413`.
