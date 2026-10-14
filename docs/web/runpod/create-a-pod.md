---
title: Create a pod
url: https://docs.runpod.io/api-reference-v2/pods/create-a-pod
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-13T20:50:08-03:00
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
- `disk`: container disk in GB, ephemeral (wiped on restart).
- `mounts`: optional storage (schema `Mounts`), below; omitted, the pod has none.

The call places one specific GPU type: it does not search for capacity or fall back to another GPU ("Checking what you can deploy").

## The host's CUDA version

`gpu` also carries constraints on the host machine's CUDA version (schema `CreateGpuConfig`):

- `minCudaVersion`: the lowest acceptable version, as `major.minor`, such as `"13.0"`, compared numerically (12.11 is above 12.2).
- `allowedCudaVersions`: an exact set, such as `["12.8", "12.6"]`. Matching is exact: a version no machine reports gives a capacity error, not a fallback. Valid versions per GPU type come from `GET /v2/catalog/gpus?include=AVAILABILITY&product=POD` (`cudaVersions`).
- A non-empty `allowedCudaVersions` and `minCudaVersion` together are refused with `400`; an empty `allowedCudaVersions` states no constraint and may go with a floor. Omitting both accepts any version.

## Storage

`mounts` takes at most one of each kind (schemas `Mounts`, `PersistentMount`, `NetworkMount`, `GlobalMount`); kinds are fixed at creation:

- `persistent` (`size`, from 10 GB, and `path`): storage on the pod's host, lost with the host; deprecated in favor of a network volume. It excludes the two others.
- `network`: one network volume (`volumeId`, `path`), which must be in the pod's data center ([network volumes](network-volumes.md)).
- `global`: one global volume (`volumeId`, optional `path`), billed by use, in any data center ([global volumes for pods](global-volumes-for-pods.md)); it can go with a network volume.

## Response

`201` with the pod, as in [Get a pod](get-a-pod.md). Provisioning is asynchronous: the pod starts in `PROVISIONING`, goes through `STARTING` and reaches `RUNNING` once its container is healthy; poll the pod rather than assume it runs. A body above 102,400 bytes is refused with `413`. The pod's `cudaVersion` is the CUDA version its host reports, or null when unknown (schema `Pod`).
