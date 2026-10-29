---
title: Runpod REST API
url: https://docs.runpod.io/api-reference-v2/openapi.json
created_at: 2026-10-29T11:07:19-03:00
updated_at: 2026-10-29T11:07:19-03:00
tool: docs/web/tools/runpod.md
---

# Runpod REST API

What Codeman relies on from the OpenAPI document of the REST API v2 (`info.title` "Runpod REST API", version 2.0.0), in its own words.

## Clouds

- The schema `Cloud` is `SECURE`, hardware in Runpod's data centers, or `COMMUNITY`, hardware run by community hosts (`components.schemas.Cloud`).
- `CreatePodRequest.cloud` takes a `Cloud`, `SECURE` when omitted, and `Pod` reports its `cloud` (`components.schemas.CreatePodRequest`, `components.schemas.Pod`).

## No interruptible pods

`CreatePodRequest`, with the `ContainerConfig` it extends, has these fields: `args`, `cloud`, `cmd`, `cpu`, `dataCenterIds`, `disk`, `entrypoint`, `env`, `globalNetworking`, `gpu`, `image`, `mounts`, `name`, `ports`, `registry`, `startJupyter`, `startSsh` and `templateId`. None of them asks for an interruptible (spot) pod or a bid, and the document names no such field anywhere (`components.schemas.CreatePodRequest`).
