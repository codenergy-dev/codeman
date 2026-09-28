---
status: completed
created_at: 2026-09-28T16:30:00-03:00
updated_at: 2026-09-28T17:40:00-03:00
commit: a497c10
---

# A comment per run

## Goal

Keep the history of a task on its issue: each run posts what it did as a new comment, and the status comment only shows where the task is now.

## Context

Codeman keeps one status comment per task and rewrites it on every run: the state, the plan's decisions, the agent's last report ("Last run"), problems and cost. Each run replaces the previous run's report, so what the design, code and test stages said is lost from the issue. The pull request's description is also rewritten, which is expected for a description; review reports already go to the pull request as new comments.

The status comment must stay: it holds the task's record (hidden, base64) and is the one place where decisions are answered. GitHub limits a comment to 65,536 characters.

A new comment notifies everyone subscribed to the issue.

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a).

1. **Shape.** Options:
   - (a) The status comment becomes the task's panel, updated in place: state, next step, plan and pull request links, decisions, workflows to review, cost. Each run posts a new comment with what it did: stage, outcome, the agent's report, problems, cost and a link to the run.
   - (b) Each run posts a new full status comment and hides the previous one as outdated (GitHub's "minimize"). The record moves to the newest one.
   - (c) One status comment, with a collapsed history section that grows each run.

   Recommendation: (a). Decisions keep a fixed place, the record does not move, and the issue reads in order. (b) scatters decisions across hidden comments; (c) hits the size limit and is still rewritten.
2. **Which runs post a comment.** Options:
   - (a) Every run that moved the task: agent runs (whatever their outcome), recorded answers, accepted workflows. Runs that only wait and try again later (the monthly budget is reached) update the panel only.
   - (b) Only agent runs.

   Recommendation: (a). Answers and accepts are part of the history, and "try again later" runs would repeat the same comment.
3. **Where.** Options:
   - (a) Always on the issue. The pull request keeps its current description and the review reports.
   - (b) On the issue until the pull request exists, then on the pull request.

   Recommendation: (a). One timeline per task, in one place.
4. **History as context for the agent.** Options:
   - (a) The stage prompt includes Codeman's earlier run comments on the task, newest last, up to a size limit (about 20,000 characters, oldest dropped first), quoted as data: the agent wrote them after reading untrusted text.
   - (b) No: each stage keeps getting only the handoff from the previous stage.

   Recommendation: (a). A stage sees why earlier stages did what they did, including skipped ones and reviews that sent work back. Only comments by the App with Codeman's run marker count, as with the status comment.

## Steps

1. A `renderRun` function for the run comment, with a hidden marker, and a `postRun` call in apply's `finish` (per decision 2). Done when unit tests cover each outcome.
2. Slim `renderStatus` into the panel: remove "Last run"; link to the newest run comment. Done when the status tests are updated.
3. Select reads the run comments (per decision 4) into the task context; the stage prompt quotes them. Done when prompt tests cover the limit and the quoting.
4. Update `docs/architecture.md` and the README's description of the status comment.
5. Rebuild `dist/`, run the tests and Biome. Done when all pass.
6. The responsible person runs a task end to end and checks the issue's timeline.

## Out of scope

- The spend table (`docs/plans/2026-09-28-spend-table.md`), which goes in the panel and in each run comment.
- Changing the pull request's description or review comments.

## Outcome

Steps 1 to 5 are done. `renderRun` and `renderStatus` in `src/status.ts` render the run comment and the panel; apply's `finish` posts the run comment and records its ID (`reportCommentId`) so the panel links it; `runHistory` in `src/tasks.ts` gives the stage prompt its "Earlier runs" section. The README does not describe the status comment, so it did not change. Step 6, the end-to-end test, is left to the responsible person.

Known limitation: a comment by the App starts a workflow run whose jobs all skip, since the workflow ignores comments by bots. That run still enters the `codeman` concurrency group, where it can replace a run that was waiting. No work is lost, because every run reads the state of every task, but the waiting request may only be handled by the next run: the chained one, the next comment or the daily schedule. The pull request review comments already had this effect.
