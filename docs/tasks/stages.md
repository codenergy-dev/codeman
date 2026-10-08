# Stages

After planning, a task goes through up to five stages, one run and one agent each, in this order: web, design, code, test and review. A routing agent chooses which of the first four run; review always runs last, and has the last word on whether the task is done. Every task therefore goes through planning, routing and review, at least.

| Stage | Does |
| --- | --- |
| Web | The documentation of the third-party services the task relies on, in `docs/web/`, following the rules for [third-party documentation](../runs/changes.md#third-party-documentation). It changes nothing else but the plan. |
| Design | Flowcharts in Mermaid (`docs/flows/*.md`), screen drafts in plain HTML (`docs/design/*.html`) and their images (`docs/screenshots/*.png`, rendered with the runner's headless Chrome), linked from the plan. It may ask the maintainers decisions, such as a choice between two layouts. |
| Code | The implementation, with unit tests for the code it writes, and the documentation it changes. |
| Test | Integration and end-to-end tests where they apply, more unit tests where coverage is thin, and every check the repository has. What can only be tested outside the task branch (a deploy, a release) goes in a "Manual tests" section of its report, which the pull request's description shows; it is no reason to block. |
| Review | A critical review against the plan and the decisions, and a merge of the default branch in its sandbox to find conflicts and integration problems early. It changes nothing; its report goes on the pull request. It is not an approval to merge. |

## Routing

The routing agent runs, in a run of its own, whenever the task needs to know what comes next: after the decisions are answered (or the plan has none), after a `fix` request, and after review asks for changes. It reads the plan, the decisions, the requests, the earlier run comments and the task branch's changes, and chooses:

- the stages that run, in the order above, each with a brief for its agent, always ending with review;
- the stages it leaves out, each with a reason. None of the stages before review is required: each task has its own needs.

Its run comment shows the route, the briefs and the reasons. Its file changes are discarded.

- When no other stage should run (the request is already done, or it needs a revised plan), the route is review alone, and the router's brief says why: review decides. On a task branch that changes nothing but the plan, review reports `blocked` when the task needed no change, so a maintainer closes the issue; no pull request opens.
- A route without review is an invalid result. Records from before review always ran may hold a route without it, which still ends with review, or an empty one, from when the router could block the task: `/codeman continue <guidance>` routes it again.
- When its result cannot be used (it failed, ran out of time, or wrote an invalid output), the stages run in their fixed order, from where the task was: design after planning, code after a request or a review. The run comment says so.
- The stages of a route read the requests the router handled, as well as newer ones.
- `/codeman continue`, accepting workflows and an unfinished stage go on with the stage they belong to; they do not route. Tasks from before routing go on in the fixed order.

## Running a stage

1. `select` picks the task and its stage, from the task record, and sets the stage's label. The agent starts from the head of the task branch, with the default branch's history, and gets the notes the previous stage left and the router's brief.
2. Each stage's agent first decides whether its stage has work; when it does not, it reports `skipped` with the reason. It writes `.codeman/output.json`: a status, a summary and, when it changed files, a commit message. Each stage may report only some statuses: `done`, `skipped`, `partial` (more work for another run of the same stage), `blocked`, `awaiting-workflow` (code and test), `decisions` (design and review) and `changes` (review).
3. `apply` filters the changes through the [change policy](../runs/changes.md#change-policy) and commits the rest to the task branch through the Git Data API, even when the agent failed or ran out of time, so no work is lost. Review's changes are discarded.
4. Then, by status:
   - `done` or `skipped`: the route's next stage runs next, with this stage's summary (or reason) as its notes. When code ends, Codeman opens the pull request as a draft, titled like the issue (`Closes #<issue>`, the plan's summary, and the code stage's commit message as the suggested squash message), so the repository's CI runs during test and review. Repositories without draft pull requests get a regular one.
   - `done` from review: Codeman adds its proposed `.codemanignore` if the repository has none, opens the pull request if there is none yet or updates its description, marks it ready for review, posts review's report on it, and sets `codeman:done`. While the agent's workflows are still staged, the task waits for them to be accepted instead, and the pull request stays a draft; see [on-demand workflows](../runs/changes.md#on-demand-workflows).
   - `changes` from review: the report goes on the pull request, and the routing agent chooses what addresses it. After `max-runs` rounds in a row, the task becomes `codeman:blocked`.
   - `decisions`: the task becomes `codeman:awaiting-decision`, with the new decisions after the plan's. When they are answered, the routing agent runs, with review's report if review asked them.
   - `partial`, or out of time: the stage runs again, up to `max-runs` runs in a row. Then the task becomes `codeman:blocked`, and a maintainer can grant another round with `/codeman continue <guidance>`.
   - `blocked`, or an invalid result: `codeman:blocked`, with the reason. `/codeman continue <guidance>` tries the stage again, and so does accepting the task's staged workflows. When the agent reported `blocked`, the run comment also suggests `/codeman replan`: a request the plan does not cover, such as a `fix` that widens the task's scope, needs a revised plan.

## Feedback

After the pull request is open, maintainers ask for changes in either of these ways:

- a review that requests changes; its text is the request;
- `/codeman fix <what to change>` in a comment on the pull request or the issue, or in a review's text.

The routing agent chooses the stages that carry out the request, and each of them gets the requests and every maintainer review since the last run that handled reviews, with the line comments and their file and line. They push to the same branch, and when the route ends, Codeman updates the pull request's description. `/codeman replan` also works on the pull request.

Codeman records the last comment and review it handled. A request is handled once a run for it ends, whatever the outcome, so a failing request does not start run after run; when the monthly budget stopped the run from starting, the request waits for a later run.
