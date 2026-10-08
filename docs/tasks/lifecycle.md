# Task lifecycle

## Tasks and states

A task is an open issue with the `codeman` label, opened by a maintainer. A maintainer applies the label to opt in; Codeman ignores everything else. (Pull requests are not handled yet.) A labeled issue that a maintainer did not open is left alone, and its status comment says why; see [untrusted input](../security/risks.md#untrusted-input).

Each task has at most one state label. A task without one has not started yet (`new`).

| Label | Meaning |
| --- | --- |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; the next run starts the routing agent. |
| `codeman:routing` | The routing agent is choosing the stages that run next. |
| `codeman:researching` | The web stage is recording third-party documentation. |
| `codeman:designing` | The design stage is working. |
| `codeman:coding` | The code stage is working. |
| `codeman:testing` | The test stage is working. |
| `codeman:reviewing` | The review stage is working. |
| `codeman:in-progress` | Left from before stages: the task goes on in the code stage. |
| `codeman:awaiting-workflow` | Waiting for workflows the agent asked for; see [on-demand workflows](../runs/changes.md#on-demand-workflows). |
| `codeman:blocked` | Needs human attention; the status comment says how to go on (usually `/codeman continue`), and the last run comment says why. |
| `codeman:done` | Reviewed; the pull request is ready for a human review. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

## Planning

1. `select` picks a `new` task, one left in `planning` by an interrupted run, or one with a `/codeman replan` request, and chooses the branch `codeman/<issue>-<slug>` and the plan path `docs/plans/<date>-<slug>.md`.
2. `agent` gives the harness a task file with the rules, the issue and the maintainer comments. The agent writes the plan and `.codeman/output.json`, which lists the decisions: a title, a question, options and a recommendation each. See [agent output](../runs/agent.md#agent-output) for its limits.
3. `apply` accepts only the plan file; other changes are ignored and listed in the run comment. It validates `output.json` strictly, commits the plan to the task branch through the Git Data API, and sets `codeman:awaiting-decision`, or `codeman:ready` when there are no decisions.

A revised plan (`/codeman replan`) keeps the decisions settled so far, with their numbers and answers, and the agent numbers its new decisions after every earlier one, so one number never means two decisions. The plan's `## Answers` section lists the settled answers from the start. The task record keeps its history: the spend table, the pull request, the handled accepts, the stages' reports and the suggested squash message. What starts over is the stages' progress, from design, and the decisions comment: the revised decisions get a new one, after the run comments before it, unless the revised plan has none.

If the agent fails, runs out of time or produces an invalid result, the task becomes `codeman:blocked`.
