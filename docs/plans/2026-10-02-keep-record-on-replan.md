---
status: completed
created_at: 2026-10-02T10:00:00-03:00
updated_at: 2026-10-02T13:00:00-03:00
commit: 205373a
---

# Keep the task's record on replan

## Goal

A revised plan (`/codeman replan`) keeps the task's spend table and the bookkeeping that is not about the plan, and numbers its decisions so that they never collide with the decisions settled before it. The plan and the stages' progress start over, and the revised decisions get a comment of their own, as today.

## Context

A task on a test repository went through `/codeman replan` and then on to `codeman:done`. Two problems showed up.

**The spend table lost its rows.** The earlier runs showed up as one "Runs without a row" line, with their total cost and no other column. `applyPlan` (`src/steps/apply.ts`) builds the record of a new plan from scratch and carries over only `pullRequest` and `language`. `finish` then starts a new table with the replan's row, and the task's total from OpenRouter, which is still right, shows the difference.

Building from scratch drops other fields too:

| Field | Effect on replan | Wanted |
| --- | --- | --- |
| `spending`, `spent` | The spend table loses its rows. | Keep. |
| `acceptedCommentId` | An earlier `/codeman accept-workflows` counts as new again: the next run handles it, finds nothing staged, and posts a run comment about it. | Keep. |
| `commitMessage` | The pull request's "Suggested squash commit message" section disappears if the code stage after the replan reports `skipped`, since it only writes a message when it changes files. | Decision 3. |
| `reports` | None: every stage runs again after a replan and writes its report, `skipped` included. | Keep, for simplicity. |
| `decisionsCommentId`, `reportCommentId` | The revised decisions get a new comment, after the run comments before it. | Reset, as today: the responsible person wants the issue to show what happened in order. When the revised plan has no decisions, the decisions comment is kept, so it says there are none instead of showing questions that no longer apply (found during the work). |
| `stage`, `runs`, `handoff`, `reviewRounds`, `awaiting`, `deferred`, `reviewed` | Work starts again at design, and each stage decides whether it has work. | Reset, as today (decision 2). |
| `accepted` | The next stage is not told which workflows a maintainer accepted. | Keep, until a stage has seen it. |

**Decision numbers collide.** The planning agent gets the settled decisions as `DECISION 1`, `DECISION 2`, and so on, and writes them into the plan as decided. Its output must number its own decisions from 1 again (`src/output.ts`), and the record keeps only those. So the plan's `## Answers` section, which Codeman writes from the record, listed decisions 1 and 2 of the revised plan, while the plan's context described decisions 1a, 2b and 3b of the first one. The review stage reported that numbering as ambiguous. Decisions that the design and review stages raise do not have this problem: Codeman numbers them after the plan's.

Rows already lost on existing tasks cannot be rebuilt: only their costs are left, in OpenRouter. Their totals stay right.

## Decisions

1. **Comments after a replan.** The revised decisions go to a new decisions comment, and the earlier comments stay as they were, so the issue reads in order.
   **Answer:** keep it as it is, from the responsible person.
2. **Where work resumes after a replan.** Options: (a) at design, as today, each stage deciding whether the revised plan gives it work; (b) at the stage the task was in. Recommendation: (a).
   **Answer:** (a), from the responsible person.
3. **The suggested squash message after a replan.** The pull request's description ends with a "Suggested squash commit message", which the code stage writes. Today a replan drops it, and if the code stage after the replan reports `skipped` because the code on the branch already fits the revised plan, the description loses that section. Options: (a) keep the message until the code stage writes a new one; (b) drop it, as today. Recommendation: (a): it describes code that is still on the branch.
   **Answer:** (a), from the responsible person.
4. **Numbering decisions after a replan.** Options: (a) the revised plan's decisions are numbered after the settled ones, and the record keeps both, so the plan's `## Answers` section, the decisions comment and `/codeman decide` use one numbering for the whole task, as stage decisions already do; (b) number them from 1 again, and tell the agent to refer to settled decisions by title in the plan. Recommendation: (a). With (b) the numbers still repeat across the task's comments, and the `## Answers` section still leaves out the settled decisions. With (a), the new decisions comment shows the settled decisions too, already answered, before the new ones.
   **Answer:** (a), from the responsible person.

## Steps

1. [x] A pure function `planRecord(previous, plan)` in `src/record.ts`, next to the record's definition, returns the new plan's record: the previous record, if any, with the new summary, decisions, handled IDs and language, and with the fields in `PLAN_RESETS` cleared (`decisionsCommentId`, unless the plan has no decisions, `reportCommentId`, and the stages' progress). Fields added to `TaskRecord` later are kept unless they are added to that list. `applyPlan` uses it. Done when unit tests show which fields are kept and which are reset.
2. [x] Decisions after a replan: the planning prompt names the settled decisions with their numbers and tells the agent to number new decisions from the next one, in `output.json` and in the plan; `parsePlanOutput` expects them from there; the record keeps the settled decisions before the new ones. Done when unit tests cover the prompt, the parser and the record, and `writeAnswers` lists settled and new decisions.
3. [x] `TaskRecord` in `src/record.ts` says that a new plan keeps every field but its own and those in `PLAN_RESETS`, which documents why each is reset. One list instead of a note next to each field, so the code and its documentation cannot disagree. Done when both are in place.
4. [x] The flow test on the fake platform (`src/steps/flow.test.ts`) goes through a replan after the code stage: the spend table keeps its earlier rows plus the replan's, the revised decisions get a new comment numbered after the settled ones, and the next stage is design. Done when it passes.
5. [x] `docs/architecture.md` says what a replan keeps and what starts over (planning; status and run comments, which says today that the record keeps the decisions comment's ID). Done when it does.
6. [x] `npm run check` passes, and a replan on the test repository keeps the spend table and numbers the revised decisions after the settled ones.
   `npm run check` passes (208 tests), and the flow test fails with the previous behavior. On 2026-10-02 the responsible person marked the plan completed without a replan on the test repository yet; it is reopened if one shows a problem.

## Out of scope

- Rebuilding the rows that tasks have already lost.
- Why the agent blocked the earlier `/codeman fix` as out of scope: the stage prompt tells it to block when a request needs a decision the plan does not cover, and `replan` is the way on.
