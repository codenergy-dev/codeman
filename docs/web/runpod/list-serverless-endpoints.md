---
title: List serverless endpoints
url: https://docs.runpod.io/api-reference-v2/serverless/list-serverless-endpoints
created_at: 2026-10-20T15:11:00-03:00
updated_at: 2026-10-20T15:11:00-03:00
tool: docs/web/tools/runpod.md
---

# List serverless endpoints

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/serverless`, with optional `cursor` and `limit` (1 to 1,000, default 1,000) ("OpenAPI", operation `listEndpoints`).

## Response

`{"endpoints": [...], "pagination": {"nextCursor", "hasNextPage"}}` (schema `ListEndpointsResponse`), newest first; follow `nextCursor` while `hasNextPage` is true. Each endpoint is as in [Get a serverless endpoint](get-a-serverless-endpoint.md), with `id`, `name`, `type`, `gpu` (`pools`, `count`, `allowedCudaVersions`, `minCudaVersion`), `workers` (`min`, `max`, `idleTimeout`), `env`, `flashboot`, `createdAt`, and `requestUrls`: the queue's operations under `https://api.runpod.ai/v2/<id>` (`run`, `runSync`, `status`, `stream`, `cancel`, `retry`, `purgeQueue`, `health`) ("OpenAPI", the response's example).
