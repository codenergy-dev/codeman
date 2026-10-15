---
status: completed
created_at: 2026-10-15T20:19:47-03:00
updated_at: 2026-10-15T20:23:55-03:00
commit: c4da7e2
---

# Refresh OpenRouter costs from any run

## Goal

An OpenRouter run whose cost was read too soon gets its cost corrected by the task's next `open-key` or `close-key`, whatever provider that run uses, so the ledger, the budgets and the spend table count what OpenRouter billed.

## Context

- **The bug.** With [profiles](../settings/profiles.md), a task's runs may use several providers. A task ran its `plan` stage on OpenRouter, then `route` and later stages on a Runpod pod. The plan run's `close-key` read a cost of US$ 0 ("OpenRouter has no cost for this run's key yet."): OpenRouter took longer to show the key's usage than `runCost` waits (about a minute). OpenRouter's dashboard now shows the cost, which is not BYOK.
- **Why it stayed 0.** Only an OpenRouter run's close returns `taskCosts` (what each run of the task spent, from its keys `codeman/<owner>/<repo>/<issue>/<run>`), which `closeKey` (`src/steps/keys.ts`) passes to `Ledger.refresh` and reports as `task-costs`, from which `apply` refreshes the spend table. `openKey` reads OpenRouter's task costs only when an OpenRouter run of the task expired. Pod and Serverless runs never read OpenRouter, so the plan run's 0 stays in the ledger, the task's spend table and the budgets (task and month). The gap predates the backend; it shows now because one task mixes providers.
- **Credentials.** Both key jobs of `templates/codeman-task.yml` already pass `management-key: ${{ secrets.CODEMAN_OPENROUTER_MANAGEMENT_KEY }}` whatever the provider, so no template change is needed. A repository without OpenRouter has an empty input: `providerAccounts(...).taskCosts` (`src/inference/index.ts`) then returns `undefined` without calling OpenRouter, and `open-key` only requires the secrets of the accounts it needs (the run's provider's, and GPU accounts for the organization's month), not OpenRouter's for a pod run.
- **`Ledger.refresh`** replaces the cost of a run when OpenRouter's figure for its workflow run differs by US$ 0.0001 or more, when the workflow run has one run of the task, the run's account is `openrouter`, and it ended (closed, or expired). A recorded 0 that OpenRouter now says is higher is replaced. `reserve` reads the task's runs in its transaction, after the refresh is written, so the reservation's task and month totals count the corrected cost. `close-key`'s `task-costs` comes from the refreshed runs.
- **Constraints.** No new dependency, no template, permission or secret change. Reading failures only warn; they never fail a key job.

## Decisions

### Answered by the responsible person on 2026-10-15

1. **Where to refresh.** In both `open-key` and `close-key`, whatever the run's provider: when the task's ledger runs include an ended OpenRouter run (closed or expired) and the job has OpenRouter's management key, list the task's OpenRouter keys and refresh the ledger with them. An OpenRouter run's own close already lists them; it does not list them twice. Without the key, the job skips the refresh and says so in an info line, only when the task has such a run. The cost is not BYOK: OpenRouter's dashboard shows it, so reading the keys again later is enough.

## Steps

1. **Shared helper.** One function in `src/steps/keys.ts` decides whether the task needs OpenRouter's costs (an ended OpenRouter run in its ledger runs), reads them through `ProviderAccounts.taskCosts`, logs a failure as a warning, and returns the costs or `undefined`. The test of "ended" is shared with `Ledger.refresh` (`ended` in `src/budget.ts`). Done: `openKey` and `closeKey` both use it; `closeKey` uses it only for a run on another provider than OpenRouter, since an OpenRouter run's close lists the task's keys itself (when that listing fails, it is not tried again).
2. **Tests** in `src/steps/keys.test.ts`: a pod run whose task has a closed OpenRouter run recorded at 0 gets its cost refreshed in `close-key` (ledger and `task-costs`) and in `open-key` (`task-spent` and the run's limit); no OpenRouter key: no failure, an info line; an OpenRouter run's close does not list the keys again; a listing failure only warns. Done.
3. **Docs and comments.** `docs/inference/openrouter.md`, `docs/budget/budget.md` and `docs/runs/runs-and-jobs.md` say that any later run of the task refreshes an OpenRouter run's cost, whatever its provider, with OpenRouter's management key; the spend table's OpenRouter note in `src/i18n/en.ts` and `src/i18n/pt-BR.ts` says the same. Done.
4. **Check.** `npm run check` passes. Done.

## Out of scope

- Refreshing OpenRouter runs of other tasks in the organization's month, such as a task whose last run was on OpenRouter and read 0: only that task's later runs correct it.
- Lengthening `runCost`'s wait at an OpenRouter run's close.
