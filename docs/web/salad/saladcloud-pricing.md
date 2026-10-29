---
title: SaladCloud Pricing
url: https://salad.com/pricing/
created_at: 2026-10-29T11:07:19-03:00
updated_at: 2026-10-29T11:07:19-03:00
tool: docs/web/tools/salad.md
---

# SaladCloud Pricing

What Codeman relies on from Salad's pricing page, in our own words. The page has no license that allows copying it.

## Prices

- The table's prices take effect on 2026-11-01 at 00:00 UTC; High, Medium and Low go up on most classes, Lowest does not ("The GPU prices below take effect…" notice).
- Prices are in USD per GPU-hour, per GPU class and priority tier (High, Medium, Low, Lowest). vCPU and RAM are included with every GPU ("Per GPU, per hour. vCPU and RAM included.").
- Examples from that table, High / Lowest: RTX 5090 (32 GB) US$ 0.600 / 0.250; RTX 4090 (24 GB) US$ 0.440 / 0.160; RTX 3090 (24 GB) US$ 0.200 / 0.090; RTX 5060 (8 GB) US$ 0.115 / 0.065. Other classes, such as the RTX 3060, start at US$ 0.015 at Lowest, and the live list is the API's GPU classes (same section).
- The tier is chosen per container group (same section).

## Billing

- Billing is per second while an instance is in the running state, and stops when the instance stops, is reallocated or is preempted ("When do charges start and stop?").
- Allocation, image download and container start are not billed ("Do I pay for cold boot time?").

## Priority tiers

From "Pay for the reliability you need.":

| Tier | Behavior |
| --- | --- |
| High | Never preempted by other workloads; still lost when its node disconnects, and reallocated automatically |
| Medium and Low | May be preempted by higher-priority groups; an instance runs roughly 30 minutes before it can be reallocated |
| Lowest (Batch) | The cheapest and most interruptible; CPU-only groups run here |

## Hosts

- Community Cloud runs on GPUs in homes and small businesses whose owners are paid for idle time ("How can prices be this low?").
- Reserved capacity is Salad Dedicated, quoted separately (the notice under the introduction, and "Volume, reserved, and private.").
