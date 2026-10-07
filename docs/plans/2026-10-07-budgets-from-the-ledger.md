---
status: in progress
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T16:12:48-03:00
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

Refined on 2026-10-07 against the backend as built ([backend plan](2026-10-07-firestore-backend.md)): runs are `organizations/{owner}/runs/{run}`, with `repository`, `task`, `workflowRun`, `month` (the UTC month `select` picked the run in), `provider` and `mode`; `open-key` and `close-key` already merge fields into them. The steps keep the decisions; what they settle beyond them is marked **Choice**.

1. **Reservations.** `open-key` reserves the run's limit in one store transaction ([`src/ledger.ts`](../../src/ledger.ts)) that reads the task's runs and the month's runs, computes the task's total and the repository's month from them, refuses the run when its limit does not fit, and otherwise writes `status: open`, `reservedAt`, `expiresAt` and `limit` on the run's document. Only then does it open the provider's run; `openedAt` follows it. A run's amount in the budgets is its `cost` once closed, and its `limit` while open, whether or not its reservation expired. Done when tests on the in-memory store open two tasks at once and two repositories at once near the monthly budget, and one of each pair is refused; and a run that never closes counts its limit before and after it expires.
   - **Choice: expiry.** A reservation expires 2 hours after it was made: the templates' timeouts for `open-key` (35 minutes), `agent` (60) and `close-key` (10), plus the waits between jobs. Expiry does not lower what the run counts; it lets OpenRouter's keys refresh the run's cost (step 2), and moves the run into Runpod's hours (step 2).
   - **Choice: a failed open.** When the provider fails to open the run, `open-key` records `status: failed` with a cost of 0, as today, where a failed open counts nothing in the task. A pod it created and terminated counts in the organization's month once Runpod bills it. If that write fails too, the reservation expires and counts its limit.
   - **Choice: a run opened again.** A re-run of `open-key` (re-running its job) reserves again on the same document; what the run spent in an earlier attempt that closed is kept as `spentBefore`, so it still counts.
   - **Choice: older tasks.** A task's first run under these budgets writes `carried` on its document: what its record counted that the ledger does not (the record's total minus the ledger's runs of the task, at least 0). The task's total adds it, so a task that started before the ledger keeps what it spent.
   - **Done on 2026-10-07**: [`src/budget.ts`](../../src/budget.ts) reads the ledger's runs (`LedgerRun`): a run's amount is its cost once known, its limit while open, plus `spentBefore`; `reserving` and `expired` tell an open run from one whose reservation passed `expiresAt`. [`src/ledger.ts`](../../src/ledger.ts) gained `taskRuns`, `monthRuns` and `reserve`, a transaction of up to 20 attempts (every `open-key` of the organization reads the month, so tasks that open at once run theirs again one after another) that queries the task's runs (`repository` and `task`) and the month's (`month`, and `repository` without an organization's budget), and writes `status: open`, `reservedAt`, `expiresAt`, `limit`, and `carried` or `spentBefore` when they apply; `open` now adds only `openedAt`, and `fail` writes `status: failed`, `failedAt`, `reason`, a cost of 0, and a `key-failed` event. [`openKey`](../../src/steps/keys.ts) reserves before it opens the provider's run, and ends the reservation when the provider fails. Runs recorded before reservations (no `reservedAt` or `expiresAt`) start at `openedAt` and expire 2 hours after. Tests: `keys.test.ts` opens two tasks at once and two repositories at once on the in-memory store (one of each pair refused when the budget leaves room for one), a run that never closes (its limit counts before and after expiry), a failed open and a carried record; `ledger.test.ts` a reservation's fields; `emulator.test.ts` two reservations at once on Firestore's emulator, where one is refused.
2. **The ledger's figures.** The task's total and the repository's month from the ledger's runs, with pods counted per task: a task's pod counts the higher of its runs' costs and the pod's cost as `close-key` last read it (`podCost`: billing, or the pod's life at its price, or the task's share of a shared pod), as the record counts it today. `close-key` writes the run's `podCost`, refreshes the task's other runs (OpenRouter keys' costs by workflow run, pods' billing), then outputs the task's total (`task-total`) and each run's cost by workflow run (`task-costs`) for `apply`, from the ledger. `open-key` refreshes the task's expired OpenRouter runs from its keys before it reserves. Runpod's billing comes by the hour (`GpuProvider.billedHours`, `GET /v2/billing?bucketSize=hour`); a reconciled month spreads each run's amount over its time (a task's pod over its runs' span), and counts each hour Runpod billed as the higher of its bill and the ledger's estimate, each other hour as the estimate, and open reservations whole. Done when tests cover a Serverless run just ended (counted before Runpod bills it), a billed hour above the ledger (untracked time counts) and one below (the ledger's estimate wins), and a task's total across OpenRouter, a pod and a refresh.
   - **Done on 2026-10-07**: `spentBy`, `taskTotal`, `costsByWorkflowRun` and `reconciledMonth` in [`src/budget.ts`](../../src/budget.ts). A task's runs on one pod are grouped by repository, task and pod, and count the higher of their amounts and their largest `podCost`. `Ledger.close` writes the run's `podCost`; `Ledger.refresh` replaces the cost of each run that closed or expired, and whose workflow run has no other run of the task, with OpenRouter's figure (an expired one becomes `status: expired`), and raises `podCost` on the task's last run on each pod. `close-key` refreshes, then outputs `task-total` and `task-costs` from the ledger; `open-key` refreshes only when the task has an expired OpenRouter run, and goes on with a warning when OpenRouter's keys cannot be read. `GpuProvider.monthSpent` became `billedHours` (Runpod: `GET /v2/billing?bucketSize=hour`, its window snapped to whole hours). [`apply`](../../src/steps/apply.ts) takes the task's total from `task-total` (without it, as when `close-key` failed, the total before the run plus the run's cost) and refreshes the rows from `task-costs`. Tests in `budget.test.ts`: a Serverless run that just ended, an hour billed above the ledger and one below, open and expired runs, a task's total across OpenRouter, pods and what its record carried; `keys.test.ts` and `selfhosted.test.ts`, refreshes from OpenRouter's keys and pods' billing.
   - **Choice: open runs in the organization's month.** An open run counts its whole limit outside the hours, even what Runpod already billed of it: it may still spend, and the double count lasts only until it closes.
   - **Choice: the month of the change.** The ledger has runs only since the backend; runs of October 2026 before it count in the organization's month through Runpod's billing only, and in no repository's month.
3. **`organization-monthly-budget`.** A setting read only from the organization's settings (`settings` input): `.codeman/settings.yml` and profiles refuse it with an error, and neither commands nor the workflow's inputs take it. `select` passes it to the task's jobs (a new matrix field and input), and `open-key` checks the organization's month, the reconciled one, in the same transaction; a run over it is refused (`over-organization-budget`), and goes back like one over the repository's month, with its own message. Done when tests show that a repository's file cannot set it and a run over it is refused.
   - **Choice: no default.** Without it, the organization's month is not limited. Codeman cannot know an organization's amount.
   - **Choice: billing's secret.** With it, the organization's month reads the billing of each GPU provider that the settings name or that the organization's runs used this month; a job without that provider's secret opens nothing (`missing-credentials`). OpenRouter's key is needed only by runs on OpenRouter.
   - **Done on 2026-10-07**: `organization-monthly-budget` in [`src/settings.ts`](../../src/settings.ts), with `ORGANIZATION_SETTINGS`: `parseSettings` refuses it unless its source is the `settings` input, profiles refuse it as any non-inference setting, and neither `TASK_SETTINGS` nor `select`'s inputs include it. `select` outputs it per task (empty when unset); `codeman.yml` passes it from the matrix, `codeman-task.yml` takes it as an input and passes it to `open-key`, which outputs `organization-month-spent` for `apply`. `reserve` checks the reconciled month in its transaction; the refusal is `over-organization-budget`, with its own message in English and Portuguese, and the task goes back like one over the repository's month. Tests: `settings.test.ts` (the file, a profile and a command cannot set it; no default), `keys.test.ts` (two repositories at once, one refused by the organization's month; a GPU provider's missing secret with the budget only), `flow.test.ts` (`select`'s output, and `apply`'s message).
   - **Choice: OpenRouter's key.** The month no longer reads OpenRouter's keys, so a run no longer needs OpenRouter's key because a profile names OpenRouter; without it, `open-key` only skips refreshing expired OpenRouter runs.
   - **Limit.** GitHub gives a repository's variable precedence over the organization's, so a repository's admins can set the budget, as any other shared setting, with a repository variable `CODEMAN_SETTINGS`, or by changing their workflow file. [Security](../security.md) says so.
4. **Remove the replaced code.** The parallel tasks' approximation (`reserved` in the inference choice), `ProviderBudget` and the providers' `taskSpent` and `monthSpent`, `accountMonthSpent` and the GPU providers' `monthSpent`, the record's self-hosted part (`selfHostedSpent`, `recorded.selfHosted`) and `countRun`'s counting, which leaves the record's list of pods (for their billing) and the spend table as its history. Older records stay readable. Done when nothing reads them.
   - **Done on 2026-10-07**: removed `ProviderBudget`, `InferenceBudget` and `Services.budget` (now `accounts()`, the `ProviderAccounts` of [`src/inference/budget.ts`](../../src/inference/budget.ts): a provider's missing secret, OpenRouter's costs of a task's runs, a GPU account's hourly billing); `InferenceProvider.taskSpent` and `monthSpent`; OpenRouter's `monthlyUsage` and `sumUsage`; `accountMonthSpent` and the GPU providers' `monthSpent`; `reserved` in the inference choice and in `select`; `recorded.selfHosted`, `selfHostedSpent`, `countRun` and `parsePodCosts`; `close-key`'s `pod-costs` output and `apply`'s input. [`src/inference/spend.ts`](../../src/inference/spend.ts) keeps the record's list of pods (`addPod`), whose billing `close-key` reads. Records keep `inference.spent` and pods' `counted` readable; nothing reads or writes them now.
5. **The spend table and docs.** The month's column is the repository's month from the ledger before the run; the notes under the table say so for each provider (English and Portuguese). Docs: [architecture](../architecture.md) (Budget, Spend, Backend's data layout and ledger, Settings), [installation](../installation.md) (the setting, shared settings, the Runpod account, profiles' secrets, workflow files), the workflow templates and `action.yml`. Done when they describe the budgets as they are.
   - **Done on 2026-10-07**: the provider notes say how a run's cost is measured, and a last note, `monthNote`, how the month is (a choice: one month note instead of one per provider, since the month is the same figure for every row). Docs: [architecture](../architecture.md) (Jobs, Budget, Layers, Spend, Backend's cost, data layout and ledger, Settings, Inference profiles), [installation](../installation.md) (parallel tasks, workflow files, shared settings, the Runpod account, profiles' secrets), [security](../security.md) (checklist), [development](../development.md) (the emulator's test), the README, `action.yml`, `templates/settings.yml` and both workflow templates.
6. Rebuild `dist/` and run `npm run check`. Done when it passes.

## End-to-end test

To be written by the implementer with the steps, covering: two parallel tasks near the monthly budget (one is refused), two repositories of the organization at once, a Serverless run counted in the month at its end, and a cancelled agent job whose reservation expires.

## Out of scope

- Splitting a Serverless worker's time between runs ([Serverless split](2026-10-07-serverless-cost-split.md)).
- Pods' registry and sharing across repositories ([pod registry](2026-10-07-pod-registry.md)).
