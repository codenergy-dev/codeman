---
title: Migrate from API v1
url: https://docs.runpod.io/api-reference-v2/migrate-from-v1
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Migrate from API v1

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Deprecation

REST API v1 (`https://rest.runpod.io/v1`) is deprecated and is retired on November 15, 2026. v2's base URL is `https://api.runpod.io/v2` ("What changed at a glance").

## What changed

- Paths ("Endpoint mapping"): pods at `/v2/pods`, Serverless endpoints at `/v2/serverless`, pod billing at `/v2/billing/pods`, Serverless billing at `/v2/billing/serverless`. `/v2/billing/endpoints` is Public Endpoint billing, not Serverless. Path parameters are a generic `{id}`.
- A pod is deleted with `DELETE /v2/pods/{id}`; other transitions go through `POST /v2/pods/{id}/action` ("Consolidated Pod lifecycle").
- Create bodies are nested: a pod takes `name` and `image`, GPU settings under `gpu: {id, count}`, and `cloud`, which defaults to `SECURE` ("Nested create bodies").
- List responses wrap the array in an object named after the resource, such as `{"pods": [...]}` ("Wrapped list responses").
- Errors follow RFC 9457: `title`, `status` and `detail` ("RFC 9457 error objects").
- `GET /v2/billing` is new: the account's spend across every kind of resource ("New in v2").
