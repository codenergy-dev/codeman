---
title: Terminate a pod
url: https://docs.runpod.io/api-reference-v2/pods/terminate-a-pod
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Terminate a pod

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Request

`DELETE /v2/pods/{id}` answers `204` with no body; `404` when the pod does not exist ("OpenAPI").

## Effect

Termination is irreversible: compute is released, host-local storage is destroyed, and the pod no longer appears in [List pods](list-pods.md). Its billing stays in [Get pod billing history](get-pod-billing-history.md).
