---
status: in progress
created_at: 2026-10-19T13:28:32-03:00
updated_at: 2026-10-19T13:30:30-03:00
commit: 073b567
---

# Keep routing quiet on budget waits

## Goal

A routing run that the monthly budget, or the organization's, refuses updates the panel only, as planning and routed stages already do. The issue then gets no run comment for a run that moved nothing.

## Context

The [plan to correct the docs](2026-10-16-correct-the-docs-against-the-code.md) found this behavior. Its decision 4 approved option 4b: add `route` to `quiet`. Until the code changes, [run comments](../tasks/comments.md#run-comments) says routing is the exception.

How the code handles a budget refusal, at `073b567`:

- Three actions take a key: `plan`, `route` and `implement`. `apply` sends only them through `keyFailed` (`src/steps/apply.ts:82-87`). `record` and `accept` run no agent and take no key. `spendRow` names the same three (`src/steps/apply.ts:1248`).
- `open-key` refuses a run with `over-budget` or `over-organization-budget` (`src/steps/keys.ts:139-150`). `keyFailed` then sends the task back to its previous state, with "Codeman will try again in a later run." and `retry: true` (`src/steps/apply.ts:220-241`). `missing-credentials` and `task-budget-spent` block the task instead, with no `retry`.
- `finish` skips the run comment when `quiet` holds: `view.retry && (task.action === "plan" || task.action === "implement")` (`src/steps/apply.ts:1154-1155`). The panel still shows the message.
- `retry` is also passed by `acceptWorkflows` (`src/steps/apply.ts:774,813`). An accept moved the task or says why it could not, so it must keep its run comment.

### Why routing was left out

[Run comments](2026-09-28-run-comments.md), decision 1a, chose that runs that only wait and try again later update the panel only. `quiet` was written then (`26b98e7`), when the actions were `plan`, `record`, `implement` and `accept`. The `route` action came later and was not added. Nothing in the code or the docs gives a reason to post its comment.

### What the run comment says

The scratch test below printed the comment of a refused routing run:

```text
### Codeman · Routing: 

The organization's monthly budget is reached: US$ 0.00 used of US$ 0.00, and this run may use up to US$ 2.00. Codeman will try again in a later run.

**Next step:** the routing agent, which chooses the stages that run next.
```

- The title ends with "Routing: " and nothing after it. `runTitle` gives `route` no text for a run without an outcome (`src/i18n/en.ts:49-50`, `src/i18n/pt-BR.ts:54-57`). Once routing is quiet, no route run reaches `finish` without an outcome.
- It has no cost: a refused run has no spend row (`src/steps/apply.ts:1247`).
- The message is the same as the panel's.

### What depends on the comment

Nothing. Checked:

| Reader | Effect of no comment |
| --- | --- |
| The panel's report link (`reportCommentId`, `src/steps/apply.ts:1178`) | It keeps pointing to the last run that moved the task, as for a refused plan or stage. |
| The agents' history (`runHistory`, `src/tasks.ts:413-430`; read by routing and stages, `src/steps/select.ts:442`) | Each refused routing run added a comment to the 20,000 characters they read. Without it, the real reports stay in. |
| Chaining (`chains`, `src/steps/apply.ts:185-188`) | A refused run never chains. Unchanged. |
| The requests (`processedCommentId`, `processedReviewId`, `src/steps/apply.ts:1128-1134`) | `retry` already leaves them for the next run. Unchanged. |
| The state | Set before the comment (`src/steps/apply.ts:1153`). Unchanged. |

### Reproduction

A scratch test on the fake platform, outside the repository, drove `select` and `apply` as `src/steps/flow.test.ts` does:

1. A plan with no decisions makes the task `codeman:ready`, with one run comment.
2. Three runs pick `route`. Their `open-key` reports `over-budget`, `over-budget`, then `over-organization-budget`.
3. After each, the task stays `codeman:ready`, `chain` is not set, and the panel shows the budget message.
4. The issue then has four run comments: one per refused routing run.

The same test showed that a refused plan posts no run comment.

With the change below applied to a copy of `src/`, the issue kept one run comment, and the tests of `src/steps/`, `src/status.test.ts` and `src/tasks.test.ts` passed: 85 tests.

## Decisions

Decision 4b of the [correction plan](2026-10-16-correct-the-docs-against-the-code.md) is approved: add `route` to `quiet`. One question remained, on how to write the condition. Answered on 2026-10-19 with its recommendation, 1a, under the responsible person's approval of the correction plan's recommendations.

1. **How `quiet` names the runs that wait.**
   - a) Add `route` to the list of actions. The list then names every action that takes a key, as `spendRow` does.
   - b) Give `finish` a flag, such as `waits: true`, that only `keyFailed` passes, and drop the action list. A future action that takes a key would be quiet with no change. It adds a field next to `retry`, whose meanings stay close.
   - c) `view.retry && task.action !== "accept"`. Same effect today, but it names the exception rather than the rule, and a new action that passes `retry` would be quiet by default.

   **Recommendation: a).** It is what decision 4b approved, and the smallest change. The set of actions changes rarely, and `spendRow` already lists the same three.

## Steps

Each step is one commit: code, tests, `dist/` rebuilt with `npm run build`, and the docs it changes. A step is done when `npm run check` passes and `git status` shows `dist/` in the commit, since CI fails when `dist/` differs from the build.

No step changes the templates, so the [template version](../development/guide.md#template-version) stays. Nothing asks anything of an installation, so [upgrading](../installation/upgrading.md) gets no entry.

### 1. Keep a routing run quiet when the budget refuses it

Assuming decision 1a.

Root cause: `src/steps/apply.ts:1155`. `quiet` lists `plan` and `implement`, but not `route`.

Code, in `src/steps/apply.ts`, `finish`:

```ts
  // A run that waits to try again moved nothing: only the panel says so.
  const quiet =
    view.retry &&
    (task.action === "plan" || task.action === "route" || task.action === "implement");
```

The line exceeds 100 characters on one line, so Biome splits it as above.

Tests, in `src/steps/flow.test.ts`, new case "a routing run the budget refuses updates the panel only":

1. `plannedTask` makes the task `codeman:ready`. Count its run comments, those that `isRunComment` (`src/status.ts:207`) accepts.
2. `selectStep` picks `route`. `applyLeg` with `key-status` `over-budget`.
3. The task is still `codeman:ready`, `chain` is not set, the panel matches "The monthly budget is reached", and the run comments are as many as in 1.
4. Repeat 2 and 3 with `over-organization-budget` and `organization-month-spent`, as the case "parallel tasks: next-run starts another run only when some task moved" does. The panel matches "The organization's monthly budget is reached".
5. Once the month has room, `routeStep` with `["code", "review"]` routes the task to `codeman:coding`, and adds one run comment.

Docs, in `docs/tasks/comments.md#run-comments`: replace the paragraph after the list with:

> A run of planning, routing or a routed stage that only waits to try again later updates the panel only. It waits because the monthly budget, or the organization's, is reached.

`docs/tasks/lifecycle.md#budget-refusals` and `docs/budget/budget.md` do not mention run comments. Check them, with no change expected.

`dist/`: rebuild, since `src/steps/apply.ts` is in the bundle.

Commit message: `Keep a routing run quiet when the budget refuses it`.

Body: say that runs that wait for the budget update the panel only since the run comments, and that `route` came later and was left out, so each refused retry posted a comment.

### 2. Close the plans

1. In the [correction plan](2026-10-16-correct-the-docs-against-the-code.md), link this plan from decision 4.
2. Set this plan to `completed`.

Commit message: `Complete the plan for quiet routing on budget waits`.

## Out of scope

- The empty outcome in the titles of `plan` and `route` runs without an outcome ("Routing: ", "Plan: "). After step 1 no run reaches them. Giving `runTitle` a text for them is a separate change.
- Other refusals: `missing-credentials` and `task-budget-spent` block the task and keep their run comment, which says how to go on.
- The `accept` runs that pass `retry`. They keep their run comment.
- Decisions 3, 6 and 7 of the correction plan, which get plans of their own.
