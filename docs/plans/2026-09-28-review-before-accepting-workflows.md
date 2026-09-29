---
status: completed
created_at: 2026-09-28T22:10:00-03:00
updated_at: 2026-09-28T23:04:00-03:00
commit: 32d122b
---

# Review before accepting workflows

## Goal

When the agent writes workflows that wait for a maintainer to accept them, the task goes on to review first. Review looks at the work and at the workflows. If it asks for changes, the code stage makes them; if it passes, the task waits for `/codeman accept-workflows`. The maintainer accepts workflows that were already reviewed, and the task does not stop halfway.

## Context

Codeman stages the workflows the agent writes under `.codeman/workflows/` until a maintainer accepts them (`docs/plans/2026-09-28-on-demand-workflows.md`). Today:

- A stage that needs a workflow's results reports `awaiting-workflow`. The task stops there (`codeman:awaiting-workflow`) until the workflow is accepted and its runs finish, even when the workflow is still staged and cannot run.
- A workflow that is what the task delivers (a deploy, for example) can reach review and `codeman:done` while still staged. Merged like that, it would sit in `.codeman/workflows/` and never run.
- Since `docs/plans/2026-09-28-resume-after-accepting-workflows.md`, accepting the workflows of a blocked task resumes its stage.

Review is the stage that judges the work, and it can already send it back to code (`changes`).

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a).

1. **The flow while workflows are staged.** Options:
   - (a) A stage that reports `awaiting-workflow` for workflows that are still staged records the wait, and the task goes on to its next stage, up to review. When review passes and staged workflows remain, the task waits for them to be accepted. After the accept:
     - if a stage waited for their runs, the task waits for the runs, then that stage resumes with their results, and the stages after it run again (test, then review);
     - if no stage waited, the task is done: the accept only moves files that did not change since review read them.

     While staged workflows remain, the pull request stays a draft, so it is not merged with the workflows in the wrong place.
   - (b) Keep the current flow: the task stops at the stage that needs the workflow.

   Recommendation: (a), as asked.
2. **The label while the task waits for the accept after review.** Options:
   - (a) `codeman:awaiting-workflow`, with a message that asks to read and accept the workflows. Nothing went wrong: the task waits for a person, as with decisions.
   - (b) `codeman:blocked`, as the request mentions.

   Recommendation: (a). `codeman:blocked` would mix this normal wait with failures, and the issue list could not tell them apart.
3. **What review checks in the workflows.** Options:
   - (a) The review prompt lists the staged workflows and asks to review them as workflows: triggers (never `pull_request_target` with a checkout of the branch), `permissions`, secrets only through a GitHub Environment, actions pinned to a full commit SHA, and that a workflow meant to wait on the task branch has `paths` filters and does not deploy. Problems go in `changes`, like any other.
   - (b) Review treats them as any other file.

   Recommendation: (a). The maintainer still reads them before accepting, with review's findings in hand.

## Steps

1. Apply: `awaiting-workflow` for staged workflows records the wait (`record.awaiting` and the waiting stage) and moves on to the next stage; review passing with staged workflows left sets the waiting state and keeps the pull request a draft. Done when unit tests cover code awaiting, test awaiting, and review passing with and without staged workflows.
2. Accept: after review, go to the waiting stage's runs, or to done (mark the pull request ready). Done when the `afterAccept` tests cover these cases, with the existing ones.
3. Select: a task that waits for runs after the accept resumes the stage that waited, as today. Done when a unit test covers it.
4. Review prompt: the staged workflows and what to check in them (decision 3). Done when the prompt tests check it.
5. Update `docs/architecture.md` (Stages, On-demand workflows) and the catalogs' messages.
6. Rebuild `dist/`, run the tests and Biome. Done when all pass.
7. The responsible person runs a task that writes a workflow and checks the flow.

## Out of scope

- Running a staged workflow before it is accepted.
- Changing how workflows are staged or accepted.

## Outcome

Steps 1 to 6 are done. `defer`, `afterReview` and `afterAccept` in `src/steps/apply.ts` hold the decisions, with the record fields `deferred` and `reviewed`. Select needed no change: after the accept, the task waits for the runs as before, and resumes the stage in `record.stage`.

Also found and fixed: a workflow the agent waits for must include its own file in its `paths` filters, or the push that accepts it would not run it. The prompt now says so.

Known limitation: Codeman looks for the awaited runs on the branch's head. If a workflow is accepted while later stages still commit, and its filters skip those commits, it never runs on the head, and the task waits until `/codeman continue`. Step 7 is left to the responsible person.
