---
status: completed
created_at: 2026-10-19T13:02:10-03:00
updated_at: 2026-10-19T13:36:36-03:00
commit: e12d349
---

# Commands around decisions and review rounds

## Goal

Three maintainer actions do what the run comments say they do:

- a `fix` or `continue` posted while a task waits for decisions is reported, not dropped silently;
- a review posted while a task waits for decisions starts no run until the task is ready, and still counts then;
- `/codeman continue` after review blocked a task for its rounds gives review a fresh count.

## Context

The [plan to correct the docs](2026-10-16-correct-the-docs-against-the-code.md) found these behaviors. Its decision 2 approved option 2b: report a `fix` or `continue` posted during `codeman:awaiting-decision`. Its Progress section lists the other two. The docs describe the current behavior until the code changes ([commands](../tasks/commands.md#commands), [runs in a row and review rounds](../tasks/stages.md#runs-in-a-row-and-review-rounds)).

How the code reads commands, at `e12d349`:

- `select` gathers the new commands of a task: maintainer comments after `processedCommentId`, and the commands of maintainer reviews after `processedReviewId` (`src/steps/select.ts:142-152`). A review that requests changes without a `fix` counts as one (`src/tasks.ts:152-165`). Review commands have `commentId: 0`.
- `pendingWork` turns them into `replan`, `resume` or `record` (`src/tasks.ts:262-271`). `chooseTask` picks `record` before anything else (`src/tasks.ts:306-307`).
- A `record` run reads only comments (`src/steps/apply.ts:1017`). `applyCommands` moves `processedCommentId` past every one of them (`src/record.ts:188-189`). `finish` moves both IDs for every other action, but not for `record` (`src/steps/apply.ts:1127-1134`).
- A `record` run always chains to another run (`src/steps/apply.ts:185-188`).

### Reproduction

A throwaway test on the fake platform (`src/testing/fake-platform.ts`), driving `select` and `apply` as `src/steps/flow.test.ts` does, reproduced all three at `e12d349`:

1. After `/codeman fix Rename it.` in `codeman:awaiting-decision`, the `record` run's comment reports nothing, and `processedCommentId` passes the comment. Once the decisions are answered, the router runs with trigger `decisions` and no requests.
2. With a review that requests changes in `codeman:awaiting-decision`, three runs in a row were `record` runs. Each chained and added a run comment, and `processedReviewId` stayed 0. Once the decisions were answered, the router ran with trigger `fix` and the review: the request is kept today.
3. With `reviewRounds` at 3 and `max-runs` at 3, review's `changes` blocked the task. `/codeman continue` ran review again with `reviewRounds` still 4, and the next `changes` blocked it again at 5.

The same test found a worse case of behavior 2. In `codeman:ready`, a review whose text has a command other than `fix`, `continue` or `replan` (such as `/codeman approve` or `/codeman set ...`) makes every run a `record` run. The task never routes. `record` runs need no key, so no budget stops them: only a new `fix`, `continue` or `replan` ends the loop.

### Checks at the start

`npm run check` passes at `e12d349`: lint, typecheck, 624 tests (621 pass, 3 skipped), and the build.

## Root causes

| Behavior | Root cause |
| --- | --- |
| 1. A `fix` or `continue` during `awaiting-decision` is dropped | `src/tasks.ts:268-269`: outside `RESUMABLE`, a `fix` or `continue` falls through to `record`. `src/record.ts:189` moves `processedCommentId` past it, and the branches at `src/record.ts:190-211` ignore it without an error. |
| 2. A review during `awaiting-decision` chains `record` runs | `src/tasks.ts:269`: `record` counts every new source, review commands included. A `record` run never handles reviews: it reads comments only (`src/steps/apply.ts:1017`) and leaves `processedReviewId` alone (`src/steps/apply.ts:1127`). So the next `select` finds the same review and picks `record` again, and `chains` (`src/steps/apply.ts:187`) starts that run. |
| 3. `continue` does not reset the review rounds | `src/steps/apply.ts:353,360`: only a `fix` request resets `reviewRounds`. The block at `src/steps/apply.ts:475-481` keeps the route and the review stage, so `continue` runs review directly (`routing` returns undefined, `src/steps/select.ts:752-775`). Its first `changes` makes the rounds `max-runs + 2`, which blocks again. The message says "Comment `/codeman continue <guidance>` to go on" (`src/i18n/en.ts:257-258`, `src/i18n/pt-BR.ts:265-266`). |

## Decisions

Answered on 2026-10-19, with the recommended option of each: 1a, 2a and 3a. Decision 1a is decision 2b of the [correction plan](2026-10-16-correct-the-docs-against-the-code.md), which the responsible person approved on 2026-10-16. Decisions 2a and 3a follow from their instruction of 2026-10-19 to implement these fixes.

1. **A `fix` or `continue` posted during `awaiting-decision`: report it or keep it?**
   - a) Report it in the `record` run's comment, and mark it handled, as today. The maintainer posts it again once the task is ready. This is decision 2b of the correction plan.
   - b) Keep it for when the task is ready.

   `processedCommentId` is one watermark over all comments. To keep a comment unhandled, the `record` run would stop the watermark before it. Then:
   - every later `record` run applies again the answers posted after it, and reports their problems again;
   - unless `pendingWork` also skips it, it makes the next run a `record` run again, which is behavior 2 for comments;
   - once the task is ready, a kept `fix` changes the first route's trigger from `decisions` to `fix`, whose fallback skips design.

   Keeping it without those effects needs a list of held comments in the record, which changes the storage format.

   **Recommendation: a).** It is one branch in `applyCommands` and one new problem kind. It keeps the watermark as it is.

2. **How a review stops chaining `record` runs.**
   - a) Only comment commands make a `record` run. A review's commands wait for a state that resumes the work, where the route or stage run handles the review, as today.
   - b) `record` runs also move `processedReviewId`. This loses the review's request, which must still count once the task is ready.
   - c) A `record` run that changed nothing does not chain. Every other event that starts a run still makes a `record` run and a run comment. In `codeman:ready`, the task still never routes.

   **Recommendation: a).** It matches what a `record` run reads. It also fixes the `codeman:ready` case. And it matches the docs: in a review, only `fix`, `continue` and `replan` count.

3. **Which `continue` resets the review rounds.**
   - a) Any `fix` or `continue` request resets them, as both already reset the runs in a row. One rule in the docs for both counters.
   - b) Only a `continue` on a task that review rounds blocked: `fromState` is `blocked` and `reviewRounds` exceeds `max-runs`.

   **Recommendation: a).** The counter stops a loop that no human steers. Any request from a maintainer steers it, as a `fix` does today. b) depends on `max-runs`, which a maintainer may change with `/codeman set` before continuing.

## Steps

Each step is one commit: code, tests, `dist/` rebuilt with `npm run build`, and the docs it changes. A step is done when `npm run check` passes and `git status` shows `dist/` in the commit, since CI fails when `dist/` differs from the build.

### 1. Report a `fix` or `continue` posted while the task awaits decisions

**Done on 2026-10-19** in `1cea2c1`.

Assuming decision 1a.

Code:

- `src/problems.ts`: add `| { kind: "awaits-decisions"; command: "fix" | "continue" }` to `CommandProblem`.
- `src/record.ts`, `applyCommands`: add a branch after `answer`:

  ```ts
  } else if (command.kind === "fix" || command.kind === "continue") {
    // A record run gets them only while the task awaits decisions, where they do not count.
    errors.push({ problem: { kind: "awaits-decisions", command: command.kind } });
  }
  ```

  Update its docstring: `fix` and `continue` are reported, since they count only once every decision is answered.
- `src/i18n/en.ts` and `src/i18n/pt-BR.ts`, `commandProblem`: add the case, for example:
  - en: "`/codeman fix` counts only once every decision is answered, so it was not applied. Comment it again then."
  - pt-BR: "`/codeman fix` só vale depois que todas as decisões tiverem resposta, por isso não foi aplicado. Comente-o de novo nessa hora."
- `src/tasks.ts:258-261`, the `pendingWork` docstring: replace "Anything else waits for its state". Comments do not wait: the task's next run marks every comment it read as handled, and a `record` run reports the `fix` and `continue` it cannot apply.

Tests:

- `src/record.test.ts`, new case "a fix or continue in a record run is reported, and its comment handled": `applyCommands` with a `fix` (comment 3) and a `continue` (comment 4) returns two `awaits-decisions` errors, and `processedCommentId` 4.
- `src/steps/flow.test.ts`, new case "a fix posted while decisions are pending is reported in the run comment": plan with one decision, `/codeman fix Rename it.`, then `select` picks `record`. Its run comment has the English message. After `/codeman approve`, the router runs with trigger `decisions` and no requests.
- `src/tasks.test.ts:383` stays: a `fix` from a comment during `awaiting-decision` still makes a `record` run.

Docs:

- `docs/tasks/commands.md`, the callout under the commands table: the `fix` or `continue` is not applied, and the run comment says so. Post it again once the task is ready.

Commit message: `Report a fix or continue posted while decisions are pending`.

### 2. Let reviews wait while the task awaits decisions

**Done on 2026-10-19** in `fed8e3a`.

Assuming decision 2a.

Code:

- `src/tasks.ts:269`: `if (DECIDING.has(state) && sources.some((source) => source.commentId > 0)) return "record";`. `commentId` is 0 for a review (`src/record.ts:166`).
- The `pendingWork` docstring adds: only comments make a `record` run, since it reads only comments. A review's commands wait for a state that resumes the work.
- `src/testing/fake-platform.ts`: add a helper `review(changeRequest, author, verdict, body): number`. It takes its ID from the same counter as comments, as real IDs grow.

Tests:

- `src/tasks.test.ts`, new case "a review's commands make no record run": `reviewCommands` of a `changes-requested` review gives `undefined` in `awaiting-decision`. A review with `/codeman approve` gives `undefined` in `ready`. The same sources plus one comment give `record`.
- `src/steps/flow.test.ts`, new case "a review while decisions are pending waits for them, and then counts":
  1. Route `code` and `review`. Code opens the draft, and review reports `decisions`, so the task is `codeman:awaiting-decision` with a pull request.
  2. A maintainer review requests changes. `select` outputs `none`, and the bot's comments do not change.
  3. `/codeman approve` makes a `record` run, and the task is `codeman:ready`.
  4. The next `select` routes with trigger `fix`, and its `reviews` hold the review. After its `apply`, `processedReviewId` is the review's ID.
- Same file, new case "a review with commands in codeman:ready does not stop the task from routing": a `commented` review with `/codeman approve`, and `select` picks `route`, not `record`.

Docs:

- `docs/tasks/commands.md`, the same callout: a review posted meanwhile starts no run, and counts once the task is ready.
- `docs/tasks/stages.md#feedback`: a review posted while the task awaits decisions waits until they are answered.
- `docs/runs/runs-and-jobs.md#the-next-run` already says tasks awaiting an answer never start a run, which becomes true. Check it, with no change expected.

Commit message: `Let reviews wait while a task awaits decisions`.

Body: say that a `record` run reads only comments, so review commands made every run a `record` run, which chained, also in `codeman:ready`.

### 3. Reset the review rounds on continue

**Done on 2026-10-19** in `6c07f05`.

Assuming decision 3a.

Code:

- `src/steps/apply.ts:353,360`: replace `fixed` with `const requested = task.requests.length > 0;`, and set `reviewRounds: requested ? 0 : task.record.reviewRounds`. Its comment: a maintainer's request starts the review rounds over, as it does the runs in a row.
- `src/i18n/en.ts:257-258`, `reviewRounds`: end with "Comment `/codeman continue <guidance>` to allow ${max} more rounds.", as `maxRuns` does. Same in `src/i18n/pt-BR.ts:265-266`: "para permitir mais ${max} rodadas".

Tests:

- `src/steps/flow.test.ts`, new case "continue after review blocks for its rounds gives review a fresh count":
  1. Route `review` alone, and set `reviewRounds` to 3 in the record, as the case "a task the router blocked before review always ran routes again on continue" edits it.
  2. Review reports `changes`, and the task is `codeman:blocked`, with "to allow 3 more rounds".
  3. `/codeman continue Go on.` runs review again. Its `changes` sends the task to `codeman:routing`, with `reviewRounds` 1.

Docs:

- `docs/tasks/stages.md#runs-in-a-row-and-review-rounds`:
  - the "Starts over" row for review rounds: "When review passes, and in the runs that carry out a `fix` or `continue` request";
  - replace the two bullets with one: after either counter blocks a task, `/codeman continue <guidance>` grants `max-runs` more.
- `docs/settings/reference.md`, the `max-runs` table, review rounds row: "A new count starts with `/codeman fix`, `/codeman continue`, or a review that passes".
- `docs/glossary.md#review-round`: the count also starts over in the runs that carry out a `continue` request.

Commit message: `Reset the review rounds on continue`.

### 4. Close the plans

**Done on 2026-10-19.** `npm run check` passes: 630 tests, 627 pass and 3 skipped.

1. In the [correction plan](2026-10-16-correct-the-docs-against-the-code.md), link this plan from decision 2 and from the two Progress bullets it takes up.
2. Set this plan to `completed`.

Commit message: `Complete the plan for commands around decisions`.

## Out of scope

- The `max-runs` off-by-one between stages and review: a stage blocks at `runs >= max-runs` and review at `rounds > max-runs`. That is decision 3 of the correction plan, and it gets a plan of its own: the [plan to align the max-runs counters](2026-10-19-align-the-max-runs-counters.md).
- Answers, `set` and `accept-workflows` in a review's text, which stay ignored. After step 2 they also no longer start a `record` run.
- Commands that count in no state of the task, such as `decide` on a `codeman:done` task. The task's next run marks them handled without a report, as today.
- A `fix` or `continue` posted while the task is `codeman:planning`.
