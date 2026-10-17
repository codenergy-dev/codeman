# Task lifecycle

## Tasks and states

A task is an open issue with the `codeman` label, opened by a maintainer. A maintainer applies the label to opt in; Codeman ignores everything else. (Pull requests are not handled yet.) A labeled issue that a maintainer did not open is left alone, and its status comment says why; see [untrusted input](../security/risks.md#untrusted-input).

Each task has at most one state label. A task without one has not started yet (`new`).

| Label | Meaning |
| --- | --- |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; the next run starts the routing agent. |
| `codeman:routing` | The routing agent is choosing the routed stages that run next. |
| `codeman:researching` | The web stage is recording third-party documentation. |
| `codeman:designing` | The design stage is working. |
| `codeman:coding` | The code stage is working. |
| `codeman:testing` | The test stage is working. |
| `codeman:reviewing` | The review stage is working. |
| `codeman:in-progress` | Left from before the routed stages: the task goes on in the code stage. |
| `codeman:awaiting-workflow` | Waiting for workflows the agent asked for; see [on-demand workflows](../runs/changes.md#on-demand-workflows). |
| `codeman:blocked` | Needs human attention; the status comment says how to go on, and the last run comment says why. When no settings serve the task's next stage, `select` blocks it before any run, and the status comment says why. |
| `codeman:done` | Reviewed; the pull request is ready for a human review. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

How to go on from `codeman:blocked` depends on why the task blocked:

- A routed stage reported `blocked`: `/codeman continue <guidance>`, or `/codeman replan <what to change>` when the request needs a revised plan.
- A routed stage wrote no result or an invalid one, ran `max-runs` times in a row unfinished, or review asked for changes more than `max-runs` times in a row: `/codeman continue <guidance>`.
- Planning failed, and the task already had a plan: `/codeman replan <what to change>`.
- The task was never planned (its first plan failed, or no settings serve planning): remove the `codeman:blocked` label. No command moves a task that has no plan.
- Codeman could not give the run access to its model: the key job failed, or the workflow does not pass a secret that a provider of the run needs. Fix the cause, then go on as for a failed run of the same stage: `/codeman continue` for routing and the routed stages, `/codeman replan` or removing the label for planning.
- The task's budget is spent: `/codeman set task-budget <usd>`, then `/codeman continue`.
- No settings serve the task's next stage: add the stage to a profile, or a top-level `model`, then `/codeman continue`, or remove the label when the task was never planned.

A run refused because the monthly budget, or the organization's, is reached does not block the task: the task goes back to the state it was in, and a later run tries again. A task refused while planning goes back to `new` (no state label). See [budget](../budget/budget.md).

A task that its [profiles](../settings/profiles.md#how-many-tasks-a-run-takes) serve only in a batch of more tasks than are ready, in its repository or, on a pod, in its pool's, waits: it keeps its label, and its status comment says how many tasks it waits for, how many are ready and in how many repositories. Every run checks it again. A task another repository's batch reserved runs in this repository's next run, which checks it is still ready first ([reservations](../runs/batches.md#reservations)).

Each agent run is a stage; what each one does, from planning to review, is in [stages](stages.md).
