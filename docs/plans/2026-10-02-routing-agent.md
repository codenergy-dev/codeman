---
status: completed
created_at: 2026-10-02T18:15:00-03:00
updated_at: 2026-10-02T21:48:00-03:00
commit: d0637c8
---

# Routing agent

## Goal

A routing agent decides which stages run next, in which order, and what each must focus on. It runs after the maintainers answer decisions, after a `/codeman fix`, and after a review that asks for changes. The stages then follow its route instead of a fixed order.

## Context

The order of stages is fixed today ([architecture](../architecture.md#stages)):

| When | What runs next |
| --- | --- |
| Decisions answered after planning | Design, code, test, review. |
| Decisions answered after design | Design goes on, then code, test, review. |
| Decisions answered after review | Code, with the review's report, then test and review. |
| `/codeman fix`, or a review that requests changes | Code, then test and review. |
| Review asks for changes (`changes`) | Code, with the review's report, then test and review. |

Each stage's agent decides only whether its own stage has work, and reports `skipped` when it does not. That costs a run per skipped stage, and no agent looks at the whole task to decide, for example, that a review finding about a screen needs design again before code, or that a one-line fix needs no new tests. Nor does any stage get a brief beyond the previous stage's notes.

What constrains the design:

- Only the `agent` job runs an LLM, with a key opened for the run ([jobs](../architecture.md#jobs)). The router is therefore an agent run of its own, with its own key, spend row and run comment.
- The router reads the same untrusted text as the stages, so it runs in the same sandbox, and `apply` validates its output strictly.
- A run that only routes moves the task, so `next-run` starts the first stage of the route.
- `max-runs`, review rounds and the budgets keep bounding the loop.
- `/codeman continue`, accepting workflows and `partial` resume the stage they belong to; they do not route.
- A route may leave out any stage (decision 2), so the task's end no longer depends on review. When the route's last stage ends, Codeman does what a passing review does today: it opens the pull request if there is none yet, adds the proposed `.codemanignore`, marks the pull request ready and sets `codeman:done`, or waits for staged workflows to be accepted. Without review, the pull request's description says that the router left review out, and why.

## Decisions

Answered on 2026-10-02 by the responsible person: the recommendation of each, except decision 2.

1. **What the router decides.** Options:
   - (a) The whole route: an ordered subset of the stages, each with a brief for its agent. It runs once at each trigger.
   - (b) Only the next stage; the router runs again after every stage.

   Recommendation: (a). It runs at the three points asked for, adds one run per trigger instead of one per stage, and the briefs give each agent a focus. A stage that finds the route wrong reports `blocked`, as today.
2. **What the router may leave out.** Options:
   - (a) Design and test. Code always runs, since every trigger asks for a change to the work (documentation included), and review always runs last. Stages keep their order.
   - (b) Any stage except review, in any order.
   - (c) Any stage, including review.

   Recommendation: (a). Review stays the independent check before the pull request is ready, and a fixed order keeps the handoffs between stages the same as today.

   **Answer:** the router may leave out any stage, review included, because each task has its own needs. Every stage it leaves out comes with a reason, shown in the run comment. Stages that run keep their order. A route with no stage means that, in the router's view, nothing should run next: the task becomes `codeman:blocked`, and the run comment gives the router's reason and what it suggests doing (for example `/codeman replan`, a `/codeman fix` with more detail, or closing the issue).
3. **When the plan has no decisions.** Options:
   - (a) The router also runs when planning ends without decisions, so every task starts through it.
   - (b) Without decisions, the fixed order applies.

   Recommendation: (a). One path for every task, and the router can leave out design for a task with no screen at the cost of one run, instead of a design run that skips.
4. **A router that fails.** Options:
   - (a) The fixed order of today applies, and the run comment lists the problem.
   - (b) The task becomes `codeman:blocked`, like a failed stage.

   Recommendation: (a). The fixed order is always a valid route, so a router failure need not stop the task.
5. **Scope beyond the plan.** Options:
   - (a) The router may report `blocked` with a reason, and the run comment suggests `/codeman replan`, as stages do today.
   - (b) The router may send the task back to planning by itself.

   Recommendation: (a). Replanning revises decisions the maintainers made, so a maintainer should ask for it.
6. **Label.** Options:
   - (a) A new state label, `codeman:routing`, while the router works.
   - (b) No new label: the task keeps `codeman:ready` or its stage's label while routing.

   Recommendation: (a). Labels are the task's state, and the issue list then shows where each task is.

## Steps

1. `route` in the task record: the stages still to run, each with its brief, and the trigger that made it. Records without it follow the fixed order. Done when `record` tests cover old and new records.
2. Selection: `select` picks the router at each trigger (decisions answered, `fix`, review `changes`, and per decision 3), sets the label (decision 6), and outputs `stage: route`. A stage that finishes with `done` or `skipped` hands over to the next stage of the route instead of `nextStage`. Done when `select` and `flow` tests cover each trigger and a route that leaves out design and test.
3. The router's prompt and output: it reads the plan, the decisions and answers, the requests (`fix` texts, reviews with line comments), the earlier run comments and the task branch's diff against the default branch. It writes `.codeman/output.json` with a status (`done` or `blocked`), a summary, the stages to run with a brief each, and the stages left out with a reason each. An empty route requires a reason and a suggestion. Its file changes are discarded, like review's. Done when `output` tests accept any subset of stages in order with a reason for each left out, and reject a stage out of order, repeated or without a reason.
4. Stages get their brief from the route next to the previous stage's notes. Done when `prompt` tests show it.
5. `apply` for the router: records the route, posts the run comment with the route, the briefs and the reasons for what it left out, and moves the task to the first stage; an empty route blocks the task with the router's suggestion (decision 2); on failure, per decision 4. Done when `apply` tests cover a full route, a route without review, an empty route and each failure.
6. The end of a route without review, as in the context: the pull request is opened if missing, marked ready, and its description says review was left out. Done when `apply` tests cover a route that ends in code and one that ends in test.
7. The spend table, run comments and i18n catalogs name the new stage in English and Brazilian Portuguese. Done when `status` tests pass in both.
8. Update [`docs/architecture.md`](../architecture.md) (states, runs, stages, feedback) and the README's flow. Done when they describe the router.
9. Rebuild `dist/`, run `npm run check`. Done when it passes.
10. The responsible person runs, on the test repository, a task with a screen, a task without one, a `/codeman fix` and a review that requests changes, and checks the routes and their reasons.

## Outcome

Steps 1 to 9 are done; step 10 is left to the responsible person, on the test repository.

- The router is a run of its own, with the action `route` and the label `codeman:routing`. `select` runs it when the task is `ready` (after answers, or a plan without decisions), when it is `routing` (review asked for changes, or an interrupted router run), on a `fix`, and on `continue` after the router blocked the task. Its spend row's stage is "routing".
- The record keeps the route: the stages with their briefs, the stages left out with their reasons, and the range of comment and review IDs the router handled, so the stages of a route read those requests again. Review is a stage of the route like the others, so it also reads the `fix` it checks.
- When the router's result cannot be used, the route is the fixed order from the stage the task was at: design after planning, code after a `fix` or a review. Decision 4's fallback reuses the route's machinery, with empty briefs.
- The end of a route without review completes the work as a passing review does, and the record keeps the router's reason (`reviewLeftOut`) for the pull request's description, which a later accept of staged workflows rewrites.
- [`docs/security.md`](../security.md) now notes that a manipulated router can leave review out.

## Out of scope

- A different model, budget or time limit for the router or per stage.
- Running stages in parallel.
- Routing after `continue`, accepting workflows or `partial`.
- The router asking the maintainers decisions.
