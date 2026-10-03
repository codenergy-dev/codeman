---
status: pending
created_at: 2026-10-02T23:08:00-03:00
updated_at: 2026-10-02T23:08:00-03:00
commit: 3fbea3e
---

# Review always runs

## Goal

Every task goes through planning, routing and review, at least. The routing agent chooses which work stages run (web, design, code, test), and may choose none, with a reason; review always ends the route and has the last word on whether the task is done.

## Context

[`2026-10-02-routing-agent`](2026-10-02-routing-agent.md) let the router leave out any stage, review included (its decision 2), and block the task with an empty route. The responsible person reconsidered: review is the stage that decides whether the work is finished, so leaving it to the router's choice puts that decision in the agent that also chose the work.

What changes, in what that plan built:

- The router's output: `review` is always the last stage of the route; it can no longer be left out.
- A route without work stages is no longer a block: it is a route with review only, and review judges whether nothing was needed.
- What only existed for routes without review goes away: completing the work at the end of any stage (`complete` after the last stage), `reviewLeftOut` in the record, and its texts in the pull request's description and the run comment.
- [`docs/security.md`](../security.md) loses the risk that a manipulated router leaves review out.

What stays: the router still runs at the same triggers, briefs each stage, gives a reason for each one it leaves out, and falls back to the fixed order when its result cannot be used (that order already ends with review).

## Decisions

Answer these before work starts.

1. **Can the router still block the task?** Today an empty route blocks it, with the router's reason and a suggestion, for requests that need a revised plan or nothing at all. Options:
   - (a) No. When nothing should run, the route is review alone; the router's reason and suggestion go in its brief, and review decides: `done`, `changes`, `decisions` or `blocked` (which already suggests `/codeman replan`).
   - (b) Yes, for a request that contradicts the plan; review runs in every other case.

   Recommendation: (a). One agent has the last word, as asked, and review already has every outcome a block needs. It costs one review run in the cases the router would have blocked.
2. **Review when the branch has nothing but the plan.** With a route of review alone right after planning, review may find no changes to judge. Options:
   - (a) Review reports `blocked`, saying that the task needed no change, so a maintainer closes the issue; no pull request opens.
   - (b) Review reports `done`, and Codeman opens a pull request with the plan alone.

   Recommendation: (a). A pull request that changes nothing but a plan has nothing to merge.

## Steps

1. The router's output requires `review` as the last stage of `route`, and the `blocked` status goes away (decision 1); its prompt says review always runs and has the last word. Done when `output` and `prompt` tests reject a route without review and accept one with review alone.
2. Review's prompt covers a branch with nothing but the plan (decision 2). Done when a `prompt` test shows it.
3. `apply`: remove completing the work at the end of a route without review, `reviewLeftOut` and the router's block; records that still hold an empty route (blocked by the router before this change) route again on `continue`, as today. Done when the `flow` tests cover a route of review alone and an older record with an empty route, and no code refers to `reviewLeftOut`.
4. Texts: remove `reviewLeftOut`, `routeBlocked` and `routeBlockedHint`, and `readySummary`'s third argument, from both catalogs. Done when they type check.
5. Update [`docs/architecture.md`](../architecture.md) (routing and running a stage), [`docs/security.md`](../security.md) and the README's flow. Done when they say review always runs.
6. Rebuild `dist/`, run `npm run check`. Done when it passes.
7. The responsible person runs, on the test repository, a task the router sends straight to review. Done when review decides it.

## Out of scope

- Making planning or routing optional.
- Changing what review checks, other than a branch with nothing but the plan.
