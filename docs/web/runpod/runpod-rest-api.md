---
title: Runpod REST API
url: https://docs.runpod.io/api-reference-v2/openapi.json
created_at: 2026-10-29T11:07:19-03:00
updated_at: 2026-10-30T11:46:20-03:00
tool: docs/web/tools/runpod.md
---

# Runpod REST API

What Codeman relies on from the OpenAPI document of the REST API v2 (`info.title` "Runpod REST API", version 2.0.0), in its own words.

## Clouds

- The schema `Cloud` is `SECURE`, hardware in Runpod's data centers, or `COMMUNITY`, hardware run by community hosts (`components.schemas.Cloud`).
- `CreatePodRequest.cloud` takes a `Cloud`, `SECURE` when omitted, and `Pod` reports its `cloud` (`components.schemas.CreatePodRequest`, `components.schemas.Pod`).

## No interruptible pods

`CreatePodRequest`, with the `ContainerConfig` it extends, has these fields: `args`, `cloud`, `cmd`, `cpu`, `dataCenterIds`, `disk`, `entrypoint`, `env`, `globalNetworking`, `gpu`, `image`, `mounts`, `name`, `ports`, `registry`, `startJupyter`, `startSsh` and `templateId`. None of them asks for an interruptible (spot) pod or a bid, and the document names no such field anywhere (`components.schemas.CreatePodRequest`).

## The container's command

A pod's command overrides its image's in three fields of `BaseContainerConfig`, which `ContainerConfig` and so `CreatePodRequest` extend (`components.schemas.BaseContainerConfig`):

| Field | Type | What it sets |
| --- | --- | --- |
| `entrypoint` | Array of strings, exec form | The image's `ENTRYPOINT`, replaced. `[]` clears it; omitted, it is left unchanged |
| `cmd` | Array of strings, exec form | The image's `CMD`: the arguments given to the entry point, when the image has one. `[]` clears it |
| `args` | String | The stored form that `entrypoint` and `cmd` encode into: a bare shell string, split into arguments and taken as `CMD` (what the console's "Container start command" writes), or a JSON object `{"entrypoint":[...],"cmd":[...]}` |

- `args` may be sent with `entrypoint` or `cmd` only when they describe the same command; responses return all three (`args`).
- The schema sets no length limit on these fields or their items. The whole request, together with any template it references, must stay within 102,400 bytes, or the call answers `413`: the description says to shorten environment variables or command values (`paths./v2/pods.post.description`).
- Exec form runs the program directly: nothing in the schema says the fields expand environment variables. A command that reads the pod's `env` runs a shell, such as `entrypoint: ["/bin/sh", "-c"]`.
- The v2 document names neither `dockerEntrypoint` nor `dockerStartCmd`, the fields of the older REST API ([Manage Pod templates](manage-pod-templates.md#the-older-rest-api)).
- The `413` above is answered "after authentication and rate limiting" (`paths./v2/pods.post.description`), where [Create a pod](create-a-pod.md#errors), recorded earlier, says before authentication.
