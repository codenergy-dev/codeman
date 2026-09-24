# Architecture

Codeman is a GitHub Action written in TypeScript. A workflow in the target repository runs it; see [installation](installation.md). The workflow template is [`templates/codeman.yml`](../templates/codeman.yml).

## Tasks and states

A task is an open issue with the `codeman` label. A maintainer applies the label to opt in; Codeman ignores everything else. (Pull requests are not handled yet.)

Each task has at most one state label. A task without one has not started yet (`new`).

| Label | Meaning |
| --- | --- |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; next run implements. |
| `codeman:in-progress` | Agent is implementing. |
| `codeman:awaiting-workflow` | Waiting for an on-demand workflow to finish. |
| `codeman:blocked` | Needs human attention; the status comment says why. Remove the label to retry. |
| `codeman:done` | Pull request opened. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

## Runs

- Triggers: a daily schedule, `workflow_dispatch`, and `issue_comment` when the comment contains `/codeman` and its author is an `OWNER`, `MEMBER` or `COLLABORATOR`.
- Only one run per repository is active (`concurrency`). GitHub keeps at most one queued run and replaces older queued runs.
- Each run reads the state of every task from GitHub instead of reacting only to the event that started it. A replaced or failed run therefore loses no work; the next run picks it up.
- Each run works on one task. Recording answers comes first, because it needs no LLM; then the oldest task that needs a plan.

## Jobs

Each stage of a run is its own job, so the workflow graph shows where a run is and where it stopped.

```
select ──▶ open-key ──▶ agent ──▶ apply
               └───────────┴────────▶ close-key
```

| Job | Does | Credentials |
| --- | --- | --- |
| `select` | Picks the task and the action (`plan`, `record` or `none`), sets `codeman:planning`, and writes the task context (`task.json`) as an artifact. | App token: issues write, contents read |
| `open-key` | Checks the monthly budget and creates the task's OpenRouter key. | OpenRouter management key, encryption secret |
| `agent` | Runs the harness on a copy of the checkout and uploads what it changed as an artifact. | Read-only `GITHUB_TOKEN`, the task key |
| `apply` | Validates the agent's result and writes it: plan commit, labels, status comment. When the action is `record`, it applies the maintainers' answers instead. | App token: contents and issues write |
| `close-key` | Disables the task key. Runs whatever happened before. | OpenRouter management key |

Only `agent` runs an LLM. The jobs that write to GitHub never run one, and they treat everything the agent produced as untrusted.

## Agent sandbox

The agent reads text from the issue, which anyone may have written, and runs shell commands. It runs as `codeman-agent`, a user without `sudo`, on a copy of the checkout in that user's home.

- It cannot read the runner's processes, so it cannot reach the job's tokens or the secrets of other steps.
- Its environment is rebuilt from an allowlist: its own `HOME` and XDG directories, a fixed `PATH`, and the harness's variables. Nothing else from the runner passes, including what `sudo`'s PAM session adds from `/etc/environment`.
- The task key reaches it only through its environment. It is the only credential the agent holds.
- When the harness exits or reaches its time limit, every process of that user is killed.
- Codeman finds changes with `git status`, using the original checkout's `.git` against the agent's copy; the agent's `.git` is never used. Changed files are copied without following symlinks.

## Budget

- Each task gets its own OpenRouter key, limited to the task budget (default US$ 2) and expiring after 24 hours.
- Keys are named `codeman/<owner>/<repo>/<issue>/<run>`. Before creating one, `open-key` adds up this month's usage (`usage_monthly`) of every key with the repository's prefix, disabled keys included. If the monthly budget (default US$ 20) would be exceeded, no key is created and the task goes back to its previous state until the next month.
- Keys are disabled, not deleted, so their usage still counts.
- Values passed between jobs appear in plain text in the logs of the job that reads them. `open-key` therefore passes the key encrypted with AES-256-GCM, using a key derived from `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`.

## Planning

1. `select` picks a `new` task (or one left in `planning` by an interrupted run) and chooses the branch `codeman/<issue>-<slug>` and the plan path `plans/<date>-<slug>.md`.
2. `agent` gives the harness a task file with the rules, the issue and the maintainer comments. The agent writes the plan and `.codeman/output.json`, which lists the decisions: a title, a question, 2 to 6 options and a recommendation each.
3. `apply` accepts only the plan file; other changes are ignored and listed in the status comment. It validates `output.json` strictly, commits the plan to the task branch through the Git Data API, and sets `codeman:awaiting-decision`, or `codeman:ready` when there are no decisions.

If the agent fails, runs out of time or produces an invalid result, the task becomes `codeman:blocked`.

## Commands

Maintainers steer a task with comments. Each line that starts with `/codeman` is a command; quoted lines and code blocks are ignored.

| Command | Effect |
| --- | --- |
| `/codeman decide 1=a 2=b` | Answers decisions 1 and 2. |
| `/codeman approve` | Accepts the recommendation for every unanswered decision. |
| `/codeman model <id>` | Uses this OpenRouter model for the task from now on. The last valid one wins. |

Only comments from owners, members and collaborators count, both for commands and for the text the agent sees. Answers are recorded in the status comment and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`.

## Status comment

Codeman keeps one comment per task up to date: state, plan link, decisions, answers, problems and the model. A hidden block in it stores the task record (branch, plan path, decisions, answers, last processed comment). Codeman reads that block only from comments written by its own GitHub App, because anyone can post a comment containing it.

Text written by the agent or by users is rendered as inert Markdown: one line, no HTML, links, images or formatting, and no @mentions.

## Untrusted input

Repositories may be public, so issue and comment text from non-maintainers is untrusted, and so is everything the agent produces.

- Comments from non-maintainers are dropped before anything reads them.
- The agent's task file marks issue text as data and wraps it in markers with a random nonce.
- Untrusted text is collapsed to one line, or prefixed, before it is logged, so it cannot inject workflow commands such as `::add-mask::`.
