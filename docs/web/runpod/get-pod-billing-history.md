---
title: Get pod billing history
url: https://docs.runpod.io/api-reference-v2/billing/get-pod-billing-history
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Get pod billing history

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`GET /v2/billing/pods`, with query parameters ("OpenAPI"):

- `startTime` and `endTime` (RFC 3339); `startTime` defaults to 30 days ago and `endTime` to now. Both are snapped to the bucket's boundaries.
- `bucketSize`: `hour`, `day` (the default), `week`, `month` or `year`.
- `podId`: only that pod's records.

## Response

`{"records": [...], "metadata": {...}}`. Without `podId`, one record per pod per bucket; each record has `podId`, `startTime`, `endTime`, and `totalAmount`, `gpuAmount`, `cpuAmount` and `diskAmount`, in USD. The records of terminated pods are included.
