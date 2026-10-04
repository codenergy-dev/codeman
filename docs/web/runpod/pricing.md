---
title: Pricing
url: https://docs.runpod.io/serverless/pricing
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Pricing

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

This is Serverless's "Pricing" page. Facts about pods come from [Billing overview](billing-overview.md).

## How workers are billed

- Per second, from when a worker starts until it fully stops, rounded up to the second (introduction).
- Flex workers scale to zero when idle; active workers run all the time ("Worker types").
- A worker is billed while it starts, while it runs requests, and during the idle timeout after them, 5 seconds by default ("Compute cost breakdown").
- The account's default spend limit is US$ 80 per hour across all resources ("Account limits").
