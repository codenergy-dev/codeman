---
title: Storage options
url: https://docs.runpod.io/pods/storage/types
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/runpod.md
---

# Storage options

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## The four kinds

From the page's comparison table ("Comparison"):

| | Container disk | Volume disk | Network volume | Global volume |
| --- | --- | --- | --- | --- |
| Lasts | Until the pod stops or restarts | Until the pod is deleted | Independently of pods | Independently of pods |
| Mounted at | Managed by the system | `/workspace` by default | `/workspace`, in place of the volume disk | `/workspace`, or `/workspace-global` beside a network volume |
| Speed | Fastest (local) | Fast (local) | Variable (network) | Variable, tuned for reads |
| Shared | No | No | Across pods | Across pods in any data center |
| Price | US$ 0.10 per GB per month | US$ 0.10 per GB per month while running, 0.20 while stopped | US$ 0.07 per GB per month | US$ 0.09 per GB per month, plus a charge per operation |

- The container disk holds the system and temporary files and caches, and is cleared when the pod stops ("Container disk").
- A global volume suits model weights and other files written rarely and read often ("Comparison", "Best for").
