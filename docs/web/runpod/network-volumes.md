---
title: Network volumes
url: https://docs.runpod.io/storage/network-volumes
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/runpod.md
---

# Network volumes

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

- **What.** Storage that lives apart from pods and workers: its data stays when a pod terminates. Backed by NVMe SSDs, at 200 to 400 MB/s, up to 10 GB/s at peak (introduction).
- **Price.** Standard storage costs US$ 0.07 per GB per month for the first terabyte and US$ 0.05 beyond; a high-performance tier costs more ("Pricing"). At a balance of US$ 0, pods with a network volume stop and keep the volume's data, but a volume whose charges stay unpaid may be terminated ("Pricing").
- **Size.** Chosen at creation, from 10 GB; it can grow, never shrink ("Create a network volume").
- **Data center.** A volume belongs to one data center. A pod can attach one only at deployment, only on Secure Cloud, and then only GPU types of that data center are offered ("Network volumes for Pods"); a Serverless endpoint with one volume runs its workers in that data center only, which may limit GPU availability ("Network volumes for Serverless").
- **Mount.** On a pod it replaces the volume disk, usually at `/workspace` ("Network volumes for Pods"); on Serverless it mounts at `/runpod-volume` ("Network volumes for Serverless").
- **Concurrent writes.** Several workers writing the same volume at once may corrupt data; the application must coordinate them ("Network volumes for Serverless").
