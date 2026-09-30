---
status: completed
created_at: 2026-09-30T16:17:00-03:00
updated_at: 2026-09-30T16:48:00-03:00
commit: d59ee13
---

# Refresh spend rows

## Goal

A run's row in the spend table no longer stays at a cost of zero when OpenRouter counted the run's usage late: `close-key` waits for a usage that the analytics shows is coming, and every run refreshes the cost of the task's earlier rows.

## Context

`close-key` reads the key's `usage` until two reads, five seconds apart, agree. When OpenRouter has not counted the run yet, two reads of zero agree, and the row keeps a cost of zero. The analytics may already have the run's tokens by then: in one task, the plan row showed 411K input tokens and a cost of US$ 0.000, and the next run's key limit showed that the plan had spent about US$ 0.05. The missing cost went into the "runs without a row" line.

`open-key` and `close-key` are the only jobs with the management key, and they must stay so. `apply` writes the table but can only get numbers from them through job outputs. Key names end with the run ID (`codeman/<owner>/<repo>/<issue>/<run>`), and each row's link ends with the same ID, so rows and keys match by run.

## Decisions

Answered on 2026-09-30: the responsible person approved the approach below.

1. **Which job reads the other runs' costs.** Options:
   - (a) `close-key`: it runs after the agent, so its reads are the freshest.
   - (b) `open-key`: it already lists the keys, but before the agent runs.

   Answer: (a).
2. **How `close-key` finds the task's keys.** Options:
   - (a) From the run key's own name, which it reads anyway: no new input.
   - (b) A new `task` input on `close-key`.

   Answer: (a).
3. **A run with several rows** (a re-run of the whole workflow opens a second key with the same name). Options:
   - (a) Leave its rows as they are, since the run's cost cannot be split between them.
   - (b) Put the run's cost on its last row and zero on the others.

   Answer: (a).

## Steps

1. `close-key` keeps reading a usage of zero, for up to about a minute more, when the analytics has tokens for the key. Done when unit tests cover a late usage, a key that spent nothing and a usage that never shows.
2. `close-key` outputs `task-costs`: what each run of the task spent, by run ID, from the task's keys. Failures only warn. Done when unit tests cover summing and matching the task's keys.
3. `apply` takes `task-costs`: it refreshes each row's cost, and takes the task's total from it. Rows folded into "earlier runs" and past run comments stay as they are. Done when unit tests cover refreshing, a run with several rows, and bad input.
4. `action.yml` and `templates/codeman.yml` pass `task-costs` from `close-key` to `apply`. Older workflow files keep working without the refresh. Done when both agree.
5. Update `docs/architecture.md` (Budget).
6. Rebuild `dist/`, run the tests, the type check and Biome. Done when all pass.
7. The responsible person updates the test repository's workflow file and checks the table after a few runs.

## Out of scope

- Refreshing tokens of earlier rows. They come from the analytics, which is read per key; the rows seen so far had them.
- Editing earlier run comments, and unfolding rows folded into "earlier runs".

## Outcome

Steps 1 to 6 are done. `runCost` and `taskCosts` in `src/steps/keys.ts` read the late usage and the task's costs; `refreshCosts` and `parseCosts` in `src/spend.ts` refresh the rows, and apply's `finish` uses them. With `task-costs`, the task's total is the sum of its runs' costs, so the rows and the total come from the same read. Step 7 is left to the responsible person; with an older workflow file, rows are not refreshed.
