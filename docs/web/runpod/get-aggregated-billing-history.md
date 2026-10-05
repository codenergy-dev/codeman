---
title: Get aggregated billing history
url: https://docs.runpod.io/api-reference-v2/billing/get-aggregated-billing-history
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Get aggregated billing history

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/billing`, with `startTime`, `endTime` and `bucketSize` (`hour` to `year`), or `lastN` ("OpenAPI"). `startTime` is snapped down to its bucket's start.

## Response

`{"records": [...], "metadata": {"query", "recordCount", "totals"}}`. Each record, and `metadata.totals`, has `totalAmount`: the account's spend in USD across every billable resource, with pod, Serverless, storage, Public Endpoint and Cluster amounts apart (`podGpuAmount`, `serverlessGpuAmount` and others).

## Observed

On 2026-10-05 the API answered `400` ("startTime and endTime must be provided together") to a request with `startTime` alone, although the OpenAPI document gives each a default. Codeman sends both.
