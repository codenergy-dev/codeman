---
status: pending
created_at: 2026-09-28T11:00:00-03:00
updated_at: 2026-09-28T11:00:00-03:00
commit: 54cc1bb
---

# Task budget

## Goal

Make `task-budget` a limit for the whole task, not for each run, and show what each task has spent on its issue and pull request.

## Context

Each run creates its own OpenRouter key, limited to the full `task-budget` (default US$ 2). A task that takes five runs (planning, a revision, two implementation runs and a fix) can therefore spend up to five times its budget. Only the monthly cap per repository bounds the total.

The keys stay per run: each key is created before the agent runs and disabled right after, so a leaked key is short-lived. What changes is its limit. Keys are named `codeman/<owner>/<repo>/<issue>/<run>` and are disabled rather than deleted, so a task's spend so far is the sum of the usage of the keys with its prefix, disabled ones included. The limit of the next run's key is what remains: after a run that spent US$ 0.20, the next key gets US$ 1.80.

Nobody sees what a task costs today, except in the OpenRouter dashboard.

## Decisions

Answer these before work starts.

1. **What the budget covers.** Options:
   - (a) The whole task, from the first plan to the last fix. When it runs out, the task becomes `codeman:blocked`, and a maintainer can raise it with `/codeman set task-budget <usd>`.
   - (b) Each request: it starts over with every `fix` or `continue`.

   Recommendation: (a). It matches "US$ 2 per task", and raising the budget is an explicit, recorded decision.
2. **The smallest budget worth a run.** A run with a few cents left fails midway and wastes the attempt. Options:
   - (a) A fixed floor of US$ 0.10. Below it, no key is created and the task is blocked with the spend.
   - (b) A `min-run-budget` setting.
   - (c) No floor.

   Recommendation: (a). A setting can come later if the floor turns out wrong for some models.
3. **Where the spend shows.** Options:
   - (a) The status comment (this run and the total) and the pull request's description, updated on every run.
   - (b) Also a custom field in a GitHub Project. That needs a project per repository and an App permission for organization projects.

   Recommendation: (a) now. (b) can follow once there is a project to put it in.
4. **When the run's spend is known.** Apply runs in parallel with `close-key`, so it cannot report the spend of the run that just ended. Options:
   - (a) Run `close-key` before `apply` (`agent → close-key → apply`). It disables the key, reads the key's final usage and passes it on, and apply writes it.
   - (b) Report each run's spend in the next run.

   Recommendation: (a). The numbers are right when people look, and the key is disabled sooner. OpenRouter may take a moment to count the last request, so `close-key` checks the usage until it stops changing, for a short while.

## Steps

- [ ] OpenRouter client: the total usage (`usage`) of the keys of one task, disabled ones included. Check the field and how soon it is updated after a request.
- [ ] `open-key`: create the key with the remaining task budget, or block the task below the floor (decision 2); check the monthly cap against that limit instead of the full task budget.
- [ ] Job order and the run's spend (decision 4); template and docs.
- [ ] Spend on the status comment and the pull request (decision 3).
- [ ] Tests for the budget arithmetic, including issue numbers that share a prefix (`/1/` and `/12/`).
- [ ] Done when: on the test repository, a task's runs never spend more than its budget in total, and its status comment shows the spend of each run and of the task.

## Out of scope

- Budgets per stage or per model.
- Estimating a run's cost before it starts.
- Budgets in currencies other than USD.
