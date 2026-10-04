---
title: Environment variables
url: https://docs.runpod.io/pods/templates/environment-variables
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Environment variables

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Limits

A pod has up to 50 environment variables ("Set environment variables"). Changing them restarts the pod ("Update environment variables").

## Variables Runpod sets

("Runpod-provided variables")

- `RUNPOD_POD_ID`: the pod's ID.
- `RUNPOD_API_KEY`: a pod-scoped API key. The page does not say what it may do.
