---
status: completed
created_at: 2026-09-28T16:35:00-03:00
updated_at: 2026-09-28T18:10:00-03:00
commit: a497c10
---

# Spend table

## Goal

The status comment shows a table of what the task spent, with one row per agent run: when, stage, model, cost, the run key's limit, the task budget and the monthly budget at the time.

## Context

The status comment's footer shows only the last run's cost and the task's total. Maintainers cannot see which stage or model spent what, nor which limits applied, without opening the OpenRouter dashboard.

What each run knows today:

- `select`: the stage, the model and the settings (`task-budget`, `monthly-budget`).
- `open-key`: what the task spent before the run, the repository's usage this month, and the key's limit (logged, not an output).
- `close-key`: the run's cost.
- `apply`: gets the task spent and the run cost as inputs, and writes the status comment and the record.

The task's total comes from OpenRouter (the sum of the task's keys), so it stays right even when a run's apply fails. Rows come from apply, so such a run has no row.

The record lives in the status comment, which GitHub limits to 65,536 characters.

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a) for decisions 1 and 3 and (b) for decision 2.

1. **Where rows come from.** Options:
   - (a) Apply appends a row to the record at the end of each run that opened a key, from the outputs of select, open-key and close-key. If the rows add up to less than the task's total, a last row shows the difference as "runs without a record".
   - (b) Rebuild the table from the task's OpenRouter keys on every run. Cost and limit are exact for every run, but the stage and model would have to go in the key's name, and only the jobs that hold the management key can read the keys.

   Recommendation: (a). Simple, and the difference row keeps the table honest.
2. **Monthly column.** Options:
   - (a) The monthly budget only.
   - (b) The monthly budget and the repository's usage at the start of the run: "US$ 3.10 of US$ 20.00".

   Recommendation: (b). open-key already computes it, and it shows how close the repository was to its cap.
3. **Size.** Options:
   - (a) Keep the last 30 rows; older rows fold into one "earlier runs" row with their count and cost.
   - (b) Keep every row.

   Recommendation: (a). About 150 characters per row, in the table and again in the record, stays far from the comment limit.

## Steps

1. `open-key` outputs `key-limit` and `month-spent`; `action.yml` and `templates/codeman.yml` pass them, with the model and stage, to apply. Done when the template and `action.yml` agree.
2. The record gets `costs` rows; apply appends one per run that opened a key, per decision 3. Done when unit tests cover appending, folding and a missing input (an older workflow file shows "—").
3. `renderStatus` renders the table, with the difference row (decision 1), in place of the cost part of the footer. Done when the status tests are updated.
4. If the run comments plan (`docs/plans/2026-09-28-run-comments.md`) is done first, each run comment shows its own row.
5. Update `docs/architecture.md` (Budget) and `docs/installation.md` if the workflow file changes.
6. Rebuild `dist/`, run the tests and Biome. Done when all pass.
7. The responsible person updates the test repository's workflow file and checks the table after a few runs.

## Out of scope

- A table on the pull request. Its footer keeps the task's total.
- Spend per model across tasks, or reports across the repository.

## Outcome

Steps 1 to 6 are done. `src/spend.ts` keeps and renders the rows; apply's `finish` adds a row for each run that opened a key. The run comments plan was done first, so each run comment shows its own row (step 4). `docs/installation.md` needed no change: it already says to copy the template. Costs show three decimals, since a run often costs less than a cent. Step 7 is left to the responsible person; with an older workflow file, the key limit and the month's spend show "—".
