---
title: Get serverless billing history
url: https://docs.runpod.io/api-reference-v2/billing/get-serverless-billing-history
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Get serverless billing history

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/billing/serverless`, with the same time parameters as [Get pod billing history](get-pod-billing-history.md) (`startTime`, `endTime`, `bucketSize` of an hour or more, `lastN`) and `serverlessId` to keep one endpoint's records ("OpenAPI").

## Response

`{"records": [...], "metadata": {...}}`: one record per endpoint per bucket, with `serverlessId` and `totalAmount`, `gpuAmount`, `cpuAmount` and `diskAmount`, in USD. Nothing finer than an hour, and nothing per request or per worker.
