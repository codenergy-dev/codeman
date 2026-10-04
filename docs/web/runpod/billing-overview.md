---
title: Billing overview
url: https://docs.runpod.io/accounts-billing/billing
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Billing overview

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Credits

- The account spends prepaid credits; compute and storage are billed per second (introduction, "Credits and balance").
- Billing runs every 5 minutes ("Low balance behavior").
- When the balance reaches US$ 0, Runpod stops every running pod; pods without a network volume are terminated ("Low balance behavior").
- Deploying a pod needs at least one hour's worth of credits for it ("Minimum balance requirements").
- Auto-pay reloads the balance from a card when it falls below a threshold ("Auto-pay"). Without it, the credits cap what the account can spend.
