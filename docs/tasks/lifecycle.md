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
| `codeman:blocked` | Needs human attention; the status comment says how to go on (usually `/codeman continue`), and the last run comment says why. |
| `codeman:done` | Reviewed; the pull request is ready for a human review. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

Each agent run is a stage; what each one does, from planning to review, is in [stages](stages.md).
