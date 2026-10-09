---
title: GPU types
url: https://docs.runpod.io/references/gpu-types
created_at: 2026-10-08T23:19:28-03:00
updated_at: 2026-10-08T23:19:28-03:00
tool: docs/web/tools/runpod.md
---

# GPU types

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## GPU IDs

The page's first table lists every GPU type Runpod offers, with three columns: the GPU ID, the display name and the memory in GB ("GPU types").

- The **GPU ID** is what the API takes and returns as a GPU type, such as the `gpu` `id` when creating a pod ([Create a pod](create-a-pod.md)) and `{id}` in [Get a GPU type](get-a-gpu-type.md). Codeman's `gpu` setting takes it.
- The **display name** is shorter, and is what the console shows. It is not an ID.

Examples from the table:

| GPU ID | Display name | Memory (GB) |
| --- | --- | --- |
| `NVIDIA RTX A6000` | RTX A6000 | 48 |
| `NVIDIA GeForce RTX 4090` | RTX 4090 | 24 |
| `NVIDIA H100 80GB HBM3` | H100 SXM | 80 |
| `NVIDIA RTX PRO 6000 Blackwell Server Edition` | RTX PRO 6000 | 96 |
| `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb` | PRO 6000 MIG 48GB | 48 |
| `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb` | PRO 6000 MIG 24GB | 24 |

- IDs hold spaces, and some hold dots and hyphens, such as `NVIDIA A100-SXM4-80GB`; not every one starts with `NVIDIA`, such as `AMD Instinct MI300X OAM` and `Tesla V100-PCIE-16GB`.
- MIG partitions of a GPU are GPU types of their own, with the partition in the ID (`MIG 2g.48gb`) and their own memory.

## GPU pools

The second table lists Serverless GPU pools, such as `AMPERE_48` (A6000, A40) and `ADA_24` (4090), for an endpoint's GPUs ("GPU pools"). Codeman does not set them: a Serverless endpoint's GPUs are set on the endpoint.

## Prices

The page does not list prices; it points to Runpod's pricing page (introduction). Codeman reads a GPU type's price from the API ([Get a GPU type](get-a-gpu-type.md)).
