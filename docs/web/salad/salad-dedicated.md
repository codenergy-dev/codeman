---
title: Salad Dedicated
url: https://salad.com/dedicated/
created_at: 2026-10-29T11:07:19-03:00
updated_at: 2026-10-29T11:07:19-03:00
tool: docs/web/tools/salad.md
---

# Salad Dedicated

What Codeman relies on from Salad Dedicated's page, in our own words. The page has no license that allows copying it.

- Salad Dedicated is reserved hardware held on contract: bare metal servers and virtual machines, with no preemption (the introduction).
- It is sold by quote, not self-serve, and allocated in order of signed agreement (the introduction, and "When can I get capacity?").
- Its first GPU is the NVIDIA RTX PRO 6000 Blackwell, with 96 GB (the introduction, "First GPU").
- Its nodes can run as a private GPU class in the customer's SaladCloud organization, so container groups are scheduled on them through the same API ("Salad orchestration, optional", "Can I use my own images and tooling?").

## Against Community Cloud

From "Dedicated vs. Community Cloud":

| | Community Cloud | Salad Dedicated |
| --- | --- | --- |
| Hardware | Consumer RTX 3060 to 5090, 8 to 32 GB | RTX PRO 6000 Blackwell, 96 GB |
| Placement | Residential and small-business nodes in 190+ countries | Reserved, single-tenant hardware |
| Interruption | Interruptible, by priority, with automatic reallocation | None during the term |
| Pricing | Per second, no commitment | By contract and quote |
