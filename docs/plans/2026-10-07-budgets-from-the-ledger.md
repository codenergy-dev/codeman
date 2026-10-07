---
status: pending
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T14:56:15-03:00
commit: a8594ea
---

# Budgets from the ledger

## Goal

The task and monthly budgets are checked against Codeman's own ledger in Firestore, with each open run's limit reserved in a transaction, so parallel tasks and repositories never overspend the month together, a Serverless run counts in the month as soon as it ends, and a month can be budgeted per repository and per organization.

## Context

- Depends on the [Firestore backend](2026-10-07-firestore-backend.md), whose ledger records each run.
- **The month today.** OpenRouter's month is its keys' monthly usage, by the repository's prefix; Runpod's is the whole account's billing, plus live pods beyond it, and counts a Serverless run an hour or more late ([spend](../architecture.md#spend), [spend table plan](2026-10-06-spend-table-providers-and-estimates.md)).
- **Parallel tasks.** Each task of a run opens its key at once with the others, so each counts, as spent, the rest of the task budgets of the tasks picked before it ([budget](../architecture.md#budget)). Different repositories on one Runpod account do not see each other at all.
- **What the ledger knows.** Each run's limit when it opens, and its cost when it closes: exact for OpenRouter, estimated for Runpod. It does not know a pod's time no run accounts for (after the last task leaves it), which only Runpod's billing shows, by the hour and late.

## Decisions

The responsible person approved the backend plan's recommendations on 2026-10-07, which this plan follows; the decisions below apply them, each with Codeman's recommendation.

1. **Reservations.** Options:
   - (a) `open-key` reserves the run's limit in the ledger, in a transaction that reads the month and refuses the run when it would go over; `close-key` replaces the reservation with the run's cost. A reservation whose run never closed (a cancelled job) expires after the longest a run can last, and then counts its whole limit, as a run without a report does today.
   - (b) Keep today's approximation.

   Recommendation: (a). It is what the store is for.

   **Answer:** (a).
2. **The month's source.** Options:
   - (a) The ledger: runs' costs and open reservations this month. For Runpod, the account's billing reconciles it: each hour already billed counts as the higher of its bill and the ledger's runs in that hour, so a pod's untracked time still counts; an hour not billed yet counts the ledger's estimates.
   - (b) The providers' figures as today.

   Recommendation: (a). It removes the Serverless lag without counting a run twice: an hour is either billed or estimated.

   **Answer:** (a).
3. **Scopes.** Options:
   - (a) `monthly-budget` limits the repository's month, from the ledger; a new `organization-monthly-budget`, read only from the organization's settings (the `CODEMAN_SETTINGS` variable), limits the organization's month: every repository's runs, plus the reconciled Runpod hours. A run must fit both.
   - (b) One month per repository only.

   Recommendation: (a). Repositories that share a Runpod account and an endpoint need a shared limit, and the account's untracked time belongs to no repository.

   **Answer:** (a).
4. **The task budget.** Options:
   - (a) The task's total comes from the ledger's runs of the task (plus open reservations), and the task record's spend stays as the table's history.
   - (b) Keep it from OpenRouter's keys and the record.

   Recommendation: (a). One source for every provider; OpenRouter's keys still refresh each run's cost in the ledger.

   **Answer:** (a).

## Steps

The implementer refines these steps against the backend as built, before starting.

1. Reservations and their expiry in `open-key` and `close-key`, with tests on the in-memory store: two tasks at once, two repositories at once, a run that never closes. Done when no combination of concurrent opens exceeds a budget.
2. The month from the ledger, reconciled with Runpod's billing per hour, and the task's total from the ledger. Done when tests cover a Serverless run just ended, a billed hour above the ledger, and one below.
3. `organization-monthly-budget`, from the organization's settings only. Done when a repository's file cannot set it, and a run over it is refused like one over the repository's month.
4. Remove the replaced code: the parallel tasks' approximation, and the account-wide month as the repository's. Done when nothing reads them.
5. The spend table: the month's column shows the repository's month; its notes say how the ledger estimates it. Docs: [architecture](../architecture.md) (Budget, Spend), [installation](../installation.md). Done when they describe the budgets as they are.
6. Rebuild `dist/` and run `npm run check`. Done when it passes.

## End-to-end test

To be written by the implementer with the steps, covering: two parallel tasks near the monthly budget (one is refused), two repositories of the organization at once, a Serverless run counted in the month at its end, and a cancelled agent job whose reservation expires.

## Out of scope

- Splitting a Serverless worker's time between runs ([Serverless split](2026-10-07-serverless-cost-split.md)).
- Pods' registry and sharing across repositories ([pod registry](2026-10-07-pod-registry.md)).
