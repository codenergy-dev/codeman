---
title: List pods
url: https://docs.runpod.io/api-reference-v2/pods/list-pods
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# List pods

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/pods`, with optional `limit` (1 to 1,000, default 1,000) and `cursor` ("OpenAPI").

## Response

`{"pods": [...], "pagination": {"nextCursor", "hasNextPage"}}`, newest first. Each pod is as in [Get a pod](get-a-pod.md). A page may hold fewer pods than `limit`: follow `nextCursor` until `hasNextPage` is false. Terminated pods are not listed (see [Terminate a pod](terminate-a-pod.md)).
