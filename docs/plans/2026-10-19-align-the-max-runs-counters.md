---
status: completed
created_at: 2026-10-19T13:29:34-03:00
updated_at: 2026-10-19T13:36:36-03:00
commit: 073b567
---

# Align the max-runs counters

## Goal

`max-runs: N` means the same thing for both counters it bounds: the Nth unfinished run of a stage in a row blocks the task, and so does the Nth `changes` from review in a row. The code, the run comments, the docs and the input descriptions all say so.

## Context

Decision 3 of the [plan to correct the docs](2026-10-16-correct-the-docs-against-the-code.md) approved option 3b: align the code. It left to this plan which limit both counters follow. Until this plan lands, the docs describe the two limits as they are ([runs in a row and review rounds](../tasks/stages.md#runs-in-a-row-and-review-rounds), [run limits](../settings/reference.md#run-limits)).

How the code counts, at `073b567`:

- **Runs in a row.** `runs` counts the runs of one stage in a row, from 1. It starts over when another stage runs, or on a `fix` or `continue` (`task.resume`, `src/steps/apply.ts:349-350`). An unfinished run blocks the task when `runs >= maxRuns` (`src/steps/apply.ts:368,371`). So the stage gets N runs.
- **Review rounds.** `reviewRounds` counts review's `changes` in a row. A `changes` blocks the task when `rounds > maxRuns` (`src/steps/apply.ts:476-478`). So review sends the work back N times, and the (N+1)th `changes` blocks.
- **The reset** (commit `6c07f05`). Every stage run that carries a maintainer's request sets `reviewRounds` to 0 before it counts (`src/steps/apply.ts:353,361`). The stage runs of a route read the requests their router handled (`src/steps/select.ts:378-396`). So a route started by a `fix` or `continue` counts its review's `changes` as round 1, and so does a `continue` that runs review again. Review passing also resets it (`src/steps/apply.ts:849`).

No decision chose the difference. Both limits date from the stages (`f17ed96`), where the record's field was "Times review sent the work back to code in a row", and the docs said "after `max-runs` rounds". The stage limit was "up to `max-runs` runs in a row".

What each place says today:

| Place | Says |
| --- | --- |
| [`docs/tasks/stages.md`](../tasks/stages.md#runs-in-a-row-and-review-rounds) | Stage: "the `max-runs`th run in a row". Review: "the rounds exceed `max-runs`: with `max-runs: 3`, the fourth `changes`". Also line 155: "Past `max-runs` review rounds" |
| [`docs/settings/reference.md`](../settings/reference.md#run-limits) | Two rows: "The run that reaches `max-runs`, the 3rd run" and "The round after `max-runs`, the 4th round" |
| [`docs/glossary.md`](../glossary.md#review-round) | "When the rounds in a row exceed `max-runs`" |
| [`docs/tasks/lifecycle.md`](../tasks/lifecycle.md) line 103 | "Review asked for changes more than `max-runs` times in a row" |
| `action.yml:35`, `templates/codeman.yml:26` | "reach max-runs, or ... pass max-runs (with 3, the 3rd run or the 4th round)" |
| `templates/settings.yml:80` | "Consecutive implementation runs before a task is blocked." It leaves out review |
| `src/settings.ts` | Only the type and the default, 3. Nothing to change |
| `src/i18n/en.ts:243-244`, `pt-BR.ts:252-253` (`maxRuns`) | "The code stage has run 3 times in a row without finishing (`max-runs` is 3) ... to allow 3 more runs." True |
| `src/i18n/en.ts:257-258`, `pt-BR.ts:265-266` (`reviewRounds`) | "Review sent the work back to the code stage 4 times in a row (`max-runs` is 3) ... to allow 3 more rounds." It sent it back 3 times: the 4th `changes` blocked instead |

### Reproduction

A throwaway test on the fake platform, driving `select` and `apply` as `src/steps/flow.test.ts` does, with `max-runs: 3`, at `073b567`:

| Counter | Outcome of each run | Run comment at the block |
| --- | --- | --- |
| Code stage, `partial` each time | 1 `codeman:coding`, 2 `codeman:coding`, 3 `codeman:blocked` | "The code stage has run 3 times in a row without finishing (`max-runs` is 3) ... to allow 3 more runs." |
| Review alone, `changes` each time | rounds 1, 2, 3 `codeman:routing`, round 4 `codeman:blocked` | "Review sent the work back to the code stage 4 times in a row (`max-runs` is 3) ... to allow 3 more rounds." |
| Review after `/codeman continue Go on.` | rounds 1, 2, 3 `codeman:routing`, round 4 `codeman:blocked` | The same |

With `rounds >= maxRuns` on a copy of `src/`, review blocked at round 3, also after `continue`. The tests of `src/steps/` all passed on the copy, including "continue after review blocks for its rounds gives review a fresh count".

## Root cause

| What | Where |
| --- | --- |
| The two counters use different comparisons | `src/steps/apply.ts:478` (`rounds > maxRuns`) against `src/steps/apply.ts:368,371` (`runs >= maxRuns`) |
| The review message counts the blocking `changes` as a round sent back | `src/i18n/en.ts:258`, `src/i18n/pt-BR.ts:266` |

## Decisions

Answered on 2026-10-19 with the recommendation of each, under the responsible person's approval of the correction plan's recommendations (decision 3b, align the code).

1. **Which rule both counters follow.**
   - a) **Block at the Nth: `count >= max-runs`.** Review blocks on its Nth `changes` in a row, as a stage does on its Nth unfinished run. With the default 3, review sends the work back twice, and the 3rd `changes` blocks. Only review's behavior changes, one round earlier. `max-runs: N` reads as its name says: at most N runs of a stage, or N review runs asking for changes, in a row.
   - b) **Block after the Nth: `count > max-runs`.** A stage blocks on its (N+1)th unfinished run. With the default 3, every stage gets a 4th run. Only the stages' behavior changes, one run later. Each extra run is an agent run that spends the task's budget, and the `maxRuns` message would read "has run 4 times in a row (`max-runs` is 3)".
   - c) **A separate setting for review rounds**, such as `max-review-rounds`. It changes the settings' format, which needs its own review, and it leaves `max-runs` meaning two things until then.

   **Recommendation: a).** It makes a run cheaper, never dearer, and the block it adds is visible and recoverable. It keeps the stage limit and its message as they are, and matches the setting's name. What changes for an existing user:
   - review blocks one round sooner: with `max-runs: 3`, the 3rd `changes` in a row instead of the 4th;
   - with `max-runs: 1`, every `changes` blocks the task: review no longer sends the work back on its own, as a stage with `max-runs: 1` is never run again on its own;
   - tasks in progress follow the new rule from their next `changes`. Their record needs no change: a task routed after its 2nd round blocks on its 3rd, and one routed after its 3rd blocks on its 4th, as before;
   - to keep review's old limit, set `max-runs` one higher, which also gives each stage one more run.

2. **Whether `docs/installation/upgrading.md` gets an entry.** The page lists "the changes of Codeman that ask something of an installation". This one asks nothing, but changes what an existing setting does, in every repository, also for tasks in progress.
   - a) **Add an entry** under Settings, "Breaking: no", with what to set to keep the old review limit. Its row in the changes table names the commit of step 1, so it is a step of its own. The pod entries with "What to do: Nothing" set the precedent.
   - b) No entry. The docs and the run comment say the new limit.

   **Recommendation: a).** A user whose tasks converged at the 3rd round sees them block after upgrading, and the page is where they look for why.

3. **Whether the `reviewRounds` message changes.** "Review sent the work back to the code stage N times in a row" is wrong under both rules: the last `changes` blocked the task instead of sending the work back.
   - a) **Reword it** to what was counted: "Review asked for changes 3 times in a row (`max-runs` is 3). Comment `/codeman continue <guidance>` to allow 3 more rounds." Keep "to allow N more rounds". After a `continue`, review gets N more `changes`, the Nth of which blocks, as `maxRuns`' "to allow N more runs" gives N more runs.
   - b) Keep it.

   **Recommendation: a).** It is the same edit in two files as the comparison, and the glossary already defines a round as one `changes`.

## Steps

### 1. Block review at its max-runs-th round

**Done on 2026-10-19** in `503e9fc`. The line numbers of `src/steps/apply.ts` were still those of `073b567`. The new test case sits before "continue after review blocks for its rounds gives review a fresh count".

Assuming decisions 1a and 3a. One commit: code, tests, docs, and `dist/` rebuilt with `npm run build`, since `src/steps/apply.ts` and the messages are bundled. Done when `npm run check` passes and `git status` shows `dist/index.js` in the commit.

Code:

- `src/steps/apply.ts`, after `const maxRuns = task.settings["max-runs"];` (line 352): one rule for both counters, so they cannot drift again.

  ```ts
  // Both counters block the task at their max-runs-th: a stage's runs in a row, review's rounds.
  const reached = (count: number): boolean => count >= maxRuns;
  ```

  Use it at lines 368 and 371 (`reached(runs)`) and at line 478 (`if (reached(rounds)) {`).
- `src/i18n/en.ts:257-258`, `reviewRounds`:

  ```ts
  `Review asked for changes ${rounds} times in a row (\`max-runs\` is ${max}). Comment \`/codeman continue <guidance>\` to allow ${max} more rounds.`,
  ```

- `src/i18n/pt-BR.ts:265-266`:

  ```ts
  `A revisão pediu mudanças ${rounds} vezes seguidas (\`max-runs\` é ${max}). Comente \`/codeman continue <orientação>\` para permitir mais ${max} rodadas.`,
  ```

Tests:

- `src/steps/flow.test.ts`, new case "max-runs blocks a stage at its max-runs-th unfinished run, and review at its max-runs-th round", with `max-runs: 2`. No test covers the stage limit today.
  1. Route `code` and `review`. Code reports `partial` twice: the first leaves `codeman:coding`; the second gives `codeman:blocked`, and the run comment matches "has run 2 times in a row without finishing (`max-runs` is 2)".
  2. `/codeman continue Go on.`, then code reports `done`, and review reports `changes`: `codeman:routing`, `reviewRounds` 1.
  3. Route `review` alone. Its `changes` gives `codeman:blocked`, `reviewRounds` 2, and the run comment matches "Review asked for changes 2 times in a row (`max-runs` is 2)".
- `src/steps/flow.test.ts:534`, "continue after review blocks for its rounds gives review a fresh count": set `reviewRounds` to 2, so the `changes` that follows is the 3rd and blocks under the new rule. The rest stays: "to allow 3 more rounds", then `reviewRounds` 1 after the `continue`.

Docs:

- `docs/tasks/stages.md`:
  - line 155: "At `max-runs` review rounds in a row, the task becomes `codeman:blocked` instead."
  - `#runs-in-a-row-and-review-rounds`: "Both are bounded by `max-runs`, the same way: the `max-runs`th in a row blocks the task." The "Blocks the task" row: "When the `max-runs`th run in a row ends unfinished: with `max-runs: 3`, the third" and "At the `max-runs`th `changes` in a row: with `max-runs: 3`, the third".
- `docs/settings/reference.md#run-limits`: "`max-runs` bounds two counts, and each blocks the task when it reaches `max-runs`: by default, at the 3rd." Drop the columns "The task is blocked by" and "By default", which become the same for both rows.
- `docs/glossary.md#review-round`: "The `max-runs`th round in a row blocks the task."
- `docs/tasks/lifecycle.md:103`: "Review asked for changes `max-runs` times in a row".
- `action.yml:35`: "(select) Blocks a task when a routed stage's runs in a row without finishing it, or review's rounds in a row asking for changes, reach max-runs (with 3, the 3rd). Empty uses .codeman/settings.yml or 3."
- `templates/codeman.yml:26`: the same, without "(select)" and the last sentence.
- `templates/settings.yml:80`: "Runs of a stage in a row without finishing it, or review rounds in a row asking for changes, before a task is blocked."

Template version: keep it. The changes to `templates/` are descriptions and a comment, which the code does not read ([when to bump](../development/guide.md#when-to-bump)). Repositories that keep their copies show the old description in the manual run's form; the upgrading entry says so.

Commit message: `Block review at its max-runs-th round, as a stage`.

Body: `max-runs` blocked a stage at its Nth unfinished run but review at its (N+1)th round. Review now blocks at its Nth, so both read as the setting's name says, and its message counts the rounds asked for, not sent back.

### 2. Add the upgrading entry

**Done on 2026-10-19** in `b1fca97`. The row and the section name step 1's commit, `503e9fc`.

Assuming decision 2a. One commit, docs only; `dist/` does not change.

- `docs/installation/upgrading.md`, a row in the changes table: date of step 1, "Review rounds block at max-runs", linked to its section, step 1's commit, "Tasks that reach review", "None, or raise `max-runs`", "No".
- A section under `## Settings`, in the page's format:
  - **Since**, **Who is affected** (every repository whose tasks reach review; most, those with `max-runs: 1`), **Breaking:** no.
  - What changes: the three bullets of decision 1a for existing users.
  - **What to do:** nothing. To keep review's old limit, set `max-runs` one higher, which also gives each stage one more run. Copying `codeman.yml` again is optional: it updates the description of the manual run's `max-runs` input.
  - **How to verify:** a task blocked by review's rounds says "Review asked for changes 3 times in a row (`max-runs` is 3)".

Done when the docs link checker in `npm test` passes.

Commit message: `Describe the review rounds limit in upgrading`.

### 3. Close the plans

**Done on 2026-10-19.** `npm run lint`, `npm run typecheck` and `npm test` pass: 632 tests, 629 pass and 3 skipped.

1. In the [correction plan](2026-10-16-correct-the-docs-against-the-code.md), link this plan from decision 3, and from the Progress bullet "`/codeman continue` does not reset review rounds", which says the `max-runs` difference stays open.
2. In the [plan for commands around decisions and review rounds](2026-10-19-commands-around-decisions-and-review-rounds.md), link this plan from its Out of scope bullet on the off-by-one.
3. Set this plan to `completed`.

Commit message: `Complete the plan for the max-runs counters`.

## Out of scope

- A separate setting for review rounds (decision 1c).
- When the counters start over. Commit `6c07f05` settled it: a `fix` or `continue` resets both, and review passing resets the rounds. This plan changes only where they block.
- Changing the default of `max-runs`.
