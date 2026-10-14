---
title: Global volumes for Pods
url: https://docs.runpod.io/storage/globalvolume/globalvolume-pods
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/runpod.md
---

# Global volumes for Pods

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

- **Beta.** Global volumes for pods are in beta; their features and behavior may change (introduction).
- **What.** Storage not bound to a data center: a pod anywhere can mount it, and its data stays when the pod stops or is deleted (introduction). Its price is in [storage options](storage-options.md).
- **Attaching.** At deployment only; a pod takes at most one global volume and one network volume ("Attach a global volume to a Pod", "Limitations").
- **Mount path.** Set at deployment: `/workspace` by default, or `/workspace-global` when a network volume takes `/workspace` ("Mount paths"). Through the API, `mounts.global` on [create a pod](create-a-pod.md).
