# Architecture

Codeman is a GitHub Action written in TypeScript. A workflow in the target repository runs it; see [installation](installation.md).

## Tasks and states

A task is an open issue or pull request with the `codeman` label. A maintainer applies the label to opt in; Codeman ignores everything else.

Each task has at most one state label. A task without one has not started yet (`new`).

| Label | Meaning |
| --- | --- |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; next run implements. |
| `codeman:in-progress` | Agent is implementing. |
| `codeman:awaiting-workflow` | Waiting for an on-demand workflow to finish. |
| `codeman:blocked` | Needs human attention; reason in the plan. |
| `codeman:done` | Pull request opened. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

The state labels live in [`src/state.ts`](../src/state.ts).

## Runs

- Triggers: a daily schedule, `workflow_dispatch`, and `issue_comment` when the comment starts with `/codeman` and its author is an `OWNER`, `MEMBER` or `COLLABORATOR`.
- Only one run per repository is active (`concurrency`). GitHub keeps at most one queued run and replaces older queued runs.
- Each run reads the state of every task from GitHub instead of reacting only to the event that started it. A replaced or failed run therefore loses no work; the next run picks it up.
- Jobs time out after 60 minutes.

Current behavior: the action lists the open tasks and their states, and changes nothing.

## Untrusted input

Repositories may be public, so issue and comment text from non-maintainers is untrusted.

- The workflow only starts on comments from authorized users. The action must check authorization again before acting on a comment.
- Untrusted text is collapsed to one line before it is logged, so it cannot inject workflow commands such as `::add-mask::`.
