---
status: completed
created_at: 2026-09-28T16:25:00-03:00
updated_at: 2026-09-28T17:05:00-03:00
commit: a497c10
---

# Resume after accepting workflows

## Goal

A task goes on to its next stage when a maintainer accepts the workflows it staged, and the test stage no longer blocks a task only because the change cannot be tested from a task branch.

## Context

End-to-end test on a private test repository, for an issue that asked for a GitHub Pages deploy workflow:

1. The code stage wrote the workflow; apply staged it under `.codeman/workflows/`.
2. The test stage reported that it could not test the deploy, with instructions to test it by hand. It reported `blocked`, so the task became `codeman:blocked`, with the staged workflow listed for review.
3. The maintainer commented `/codeman accept-workflows`. `acceptWorkflows` moved the file and kept the task's state (`task.fromState`): still `blocked`.
4. The chained run found no task that could move (a blocked task waits for `/codeman continue` or `/codeman fix`) and logged "Nothing to do."

Two problems:

- Accepting workflows answers what the stage waited for, but does not resume it. Only `awaiting-workflow` tasks go on after an accept, and only once the workflows' runs on the task branch finish.
- A deploy workflow cannot run from a task branch without deploying unreviewed work, so the test stage could never test it there. That is not a reason to block: the tests a human must run belong in the pull request, and review should still judge the work.

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a).

1. **Accepting workflows on a blocked task.** Options:
   - (a) Resume the task's recorded stage, with a fresh run count, as `/codeman continue` does. The stage's prompt says which workflows were accepted, and by whom. A task blocked with no stage (in planning) stays blocked.
   - (b) Keep the task blocked, and say in the status comment that `/codeman continue` goes on.

   Recommendation: (a). A maintainer who accepts the workflows has answered the block; asking for a second command is friction. It cannot loop: each accept comment is handled once.
2. **Work the test stage cannot test.** Options:
   - (a) Prompt only: when a change can only be tested outside the task branch (a deploy, a release, production data), the test stage tests what it can, reports `done` and puts a "Manual tests" section in its summary. That summary already goes into the pull request's description. `blocked` stays for failures that need a human.
   - (b) A new `manual` status for the test stage, with a structured list of manual steps rendered in its own pull request section.

   Recommendation: (a). No new status or format, and review still runs.
3. **Workflows the agent may wait for.** The prompt tells the agent to write a workflow that runs on pushes to the task branch when it needs one. A deploy or publish workflow must not run from the task branch. Options:
   - (a) The prompt says so: never wait for a workflow that deploys, publishes or releases; such a workflow is part of the change and runs after the merge.
   - (b) Leave the prompt as is.

   Recommendation: (a).

## Steps

1. `acceptWorkflows`: for a `blocked` task with a recorded stage, finish in that stage's state with `runs: 0` and a handoff note naming the accepted workflows and who accepted them. Done when a unit test covers the blocked, awaiting-workflow and no-stage cases.
2. Test stage prompt: add the manual-tests rule (decision 2) and the deploy rule (decision 3) to the shared rules. Done when the prompt tests check both.
3. Update `docs/architecture.md` (On-demand workflows, Stages).
4. Rebuild `dist/`, run the tests and Biome. Done when all pass.
5. The responsible person repeats the end-to-end test above; the task reaches review after the accept.

## Out of scope

- Running deploy workflows before the merge, for example in preview environments.
- Any change to how `awaiting-workflow` tasks wait for runs.

## Outcome

Steps 1 to 4 are done. `afterAccept` in `src/steps/apply.ts` decides where the task goes; the record's `accepted` field carries the accepted workflows to the next stage run, which clears it. Step 5, the end-to-end test, is left to the responsible person; the plan reopens if it fails.
