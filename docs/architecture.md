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
| `codeman:blocked` | Needs human attention; the status comment says why and how to go on (usually `/codeman continue`). |
| `codeman:done` | Pull request opened. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

## Runs

- Triggers: a daily schedule, `workflow_dispatch`, and `issue_comment` when the comment contains `/codeman` and its author is not a bot. Anyone can start a run this way, but `select` ignores comments from non-maintainers, so the run finds nothing new to do.
- Reviews also trigger a run: `pull_request_review`, on a pull request from a `codeman/` branch of the same repository, when the review requests changes or mentions `/codeman`. A review event runs the workflow file of the pull request's branch, which may be older than the default branch's, so its only job, `forward-review`, starts the default branch's workflow with `workflow_dispatch`. It holds no secrets; its `GITHUB_TOKEN` has `actions: write` only.
- Only one run per repository is active (`concurrency`). GitHub keeps at most one queued run and replaces older queued runs.
- Each run reads the state of every task from GitHub instead of reacting only to the event that started it. A replaced or failed run therefore loses no work; the next run picks it up.
- Each run works on one task. Recording answers comes first, because it needs no LLM; then the oldest task that needs a plan; then the oldest task to implement: resumed with `fix` or `continue`, or `codeman:in-progress`, before `codeman:ready`.

## Jobs

Each stage of a run is its own job, so the workflow graph shows where a run is and where it stopped.

```
select ──▶ open-key ──▶ agent ──▶ apply
               └───────────┴────────▶ close-key
```

| Job | Does | Credentials |
| --- | --- | --- |
| `select` | Reads the settings and `.codemanignore` from the default branch, picks the task and the action (`plan`, `implement`, `record` or `none`), sets `codeman:planning` or `codeman:in-progress`, and writes the task context (`task.json`) as an artifact. | App token: issues write, contents read |
| `open-key` | Checks the monthly budget and creates the task's OpenRouter key. | OpenRouter management key, encryption secret |
| `agent` | Runs the harness on a copy of the checkout and uploads what it changed as an artifact, even when the agent fails or runs out of time. | Read-only `GITHUB_TOKEN`, the task key |
| `apply` | Validates the agent's result and writes it: commits, pull request, labels, status comment. When the action is `record`, it applies the maintainers' answers instead. | App token: contents, issues and pull requests write |
| `close-key` | Disables the task key. Runs whatever happened before. | OpenRouter management key |

Only `agent` runs an LLM. The jobs that write to GitHub never run one, and they treat everything the agent produced as untrusted.

## Agent sandbox

The agent reads text from the issue, which anyone may have written, and runs shell commands. It runs as `codeman-agent`, a user without `sudo`, on a copy of the checkout in that user's home.

- It cannot read the runner's processes, so it cannot reach the job's tokens or the secrets of other steps.
- The runner's home, which holds the job's temporary files, is closed to other users before the agent starts. The agent is not in the `docker` group.
- Its environment is rebuilt from an allowlist: its own `HOME` and XDG directories, the job's `PATH` without entries in the runner's home, and the harness's variables. Nothing else from the runner passes, including what `sudo`'s PAM session adds from `/etc/environment`.
- Its tools and network are not restricted: it can use what the runner image has and what earlier steps of the job set up. The sandbox protects credentials, not the runner.
- The task key reaches it only through its environment. It is the only credential the agent holds.
- When the harness exits or reaches its time limit, every process of that user is killed.
- Codeman finds changes with `git status`, using the original checkout's `.git` against the agent's copy; the agent's `.git` is never used. Changed files are copied without following symlinks.

## Budget

- Each task gets its own OpenRouter key, limited to the task budget (default US$ 2) and expiring after 24 hours.
- Keys are named `codeman/<owner>/<repo>/<issue>/<run>`. Before creating one, `open-key` adds up this month's usage (`usage_monthly`) of every key with the repository's prefix, disabled keys included. If the monthly budget (default US$ 20) would be exceeded, no key is created and the task goes back to its previous state until the next month.
- Keys are disabled, not deleted, so their usage still counts.
- Values passed between jobs appear in plain text in the logs of the job that reads them. `open-key` therefore passes the key encrypted with AES-256-GCM, using a key derived from `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`.

## Planning

1. `select` picks a `new` task, one left in `planning` by an interrupted run, or one with a `/codeman replan` request, and chooses the branch `codeman/<issue>-<slug>` and the plan path `plans/<date>-<slug>.md`.
2. `agent` gives the harness a task file with the rules, the issue and the maintainer comments. The agent writes the plan and `.codeman/output.json`, which lists the decisions: a title, a question, 2 to 6 options and a recommendation each.
3. `apply` accepts only the plan file; other changes are ignored and listed in the status comment. It validates `output.json` strictly, commits the plan to the task branch through the Git Data API, and sets `codeman:awaiting-decision`, or `codeman:ready` when there are no decisions.

If the agent fails, runs out of time or produces an invalid result, the task becomes `codeman:blocked`.

## Implementation

1. `select` picks a `codeman:in-progress` or `codeman:ready` task and sets `codeman:in-progress`. The agent starts from the head of the task branch.
2. `agent` gives the harness the plan's path, the rules (including the protected paths and file limits), the issue and the maintainer comments. The agent implements the next steps, updates the documentation and the plan's progress, runs the repository's checks, and writes `.codeman/output.json`: a status (`done`, `partial` or `blocked`), a summary, a commit message and, when blocked, the reason.
3. `apply` filters the changes through the [change policy](#change-policy) and commits the rest to the task branch through the Git Data API. It commits even when the agent failed or ran out of time, so no work is lost.
4. Then, by status:
   - `done`: Codeman adds its proposed `.codemanignore` if the repository has none, opens a pull request from the task branch (`Closes #<issue>`, the plan's summary, the agent's summary and a suggested squash commit message), and sets `codeman:done`.
   - `partial`, or out of time: the task stays `codeman:in-progress`, and the next run continues it, up to `max-runs` runs in a row. Then it becomes `codeman:blocked`, and a maintainer can grant another round with `/codeman continue <guidance>`.
   - `blocked`, or an invalid result: `codeman:blocked`, with the reason. `/codeman continue <guidance>` tries again.

### Feedback

After the pull request is open, maintainers ask for changes in either of these ways:

- a review that requests changes; its text is the request;
- `/codeman fix <what to change>` in a comment on the pull request or the issue, or in a review's text.

The task goes back to `codeman:in-progress` with a new run count. The agent gets the requests and every maintainer review since the last run that handled reviews, with the line comments and their file and line. It pushes to the same branch, and when it reports done again, Codeman updates the pull request's description. `/codeman replan` also works on the pull request.

Codeman records the last comment and review it handled. A request is handled once a run for it ends, whatever the outcome, so a failing request does not start run after run; when the monthly budget stopped the run from starting, the request waits for a later run.

## Change policy

Apply commits only regular files that pass these rules; it drops the others and lists them on the status comment.

- `.codemanignore` at the repository's root lists the paths the agent may not change, in `.gitignore` syntax. `!` re-allows a path. A file inside an excluded directory cannot be re-allowed: to re-allow a whole subdirectory, add both `!/dir/sub/` and `!/dir/sub/**`.
- Without that file, Codeman uses its own rules: `/.github/**`, the harness's configuration (`opencode.json`, `opencode.jsonc`, `/.opencode/**`) and agent instructions (`AGENTS.md`, `CLAUDE.md`, `/.claude/**`, `/.agents/**`). Its first pull request proposes them as the repository's `.codemanignore`. Agent instructions are protected because later runs would follow a changed version before anyone reviewed it.
- When the repository's file stops protecting one of those paths, `select` warns in the run's summary.
- Whatever the file says, the agent never changes `.codemanignore` or `.codeman/`, since it must not change its own rules, nor `.github/workflows/`, which apply's token cannot write.
- The plan file is always accepted.
- Each file may have at most `max-file-bytes`. A run that changes more than `max-files` files commits nothing and blocks the task.

Codeman reads the rules from the default branch, never from the task branch, so one run cannot loosen them for the next. Matching uses `git check-ignore` in an empty repository, so git's own rules apply.

## Settings

Each value comes from the first of these that sets it:

1. A `/codeman set` command on the task (only `model`, `task-budget` and `max-runs`).
2. The workflow's inputs, in a manual run.
3. `.codeman/settings.yml` on the default branch.
4. Codeman's default.

| Name | Default | Meaning |
| --- | --- | --- |
| `model` | none; required | OpenRouter model ID |
| `task-budget` | `2` | Spending limit of each task key, in USD |
| `monthly-budget` | `20` | Spending limit per calendar month for the repository, in USD |
| `max-runs` | `3` | Implementation runs in a row without finishing before a task is blocked |
| `max-files` | `300` | Files one run may change |
| `max-file-bytes` | `1048576` | Size limit of each changed file |

The settings file accepts only `name: value` lines, comments and blank lines; see [`templates/settings.yml`](../templates/settings.yml). Anything else stops the run with an error, so the file never means something other than what it looks like.

## Commands

Maintainers steer a task with comments on its issue or on its pull request, and with review texts. Each line that starts with `/codeman`, outside a fenced code block, is a command; one comment may hold several. Answers (`decide`, `approve`, `answer`) count while the task is `codeman:awaiting-decision` or `codeman:ready`; `fix` and `continue` once it is ready or later; `replan` and `set` in any state.

| Command | Effect |
| --- | --- |
| `/codeman decide 1 a` | Answers decision 1 with option `a`. Several at once: `/codeman decide 1 a 2 b`. `1=a` also works. |
| `/codeman approve` | Accepts the recommendation for every unanswered decision. |
| `/codeman answer 2 <text>` | Answers decision 2 in the maintainer's own words instead of an option. The text continues on the following lines, up to the next command. |
| `/codeman replan <text>` | Sends the task back to planning. The agent revises the plan with the text (which may continue on the following lines), the maintainer comments and the answers given so far; answered decisions are written into the plan as settled, and only open or new decisions are listed. |
| `/codeman fix <text>` | Asks for changes to the implementation. Also a review that requests changes. See [feedback](#feedback). |
| `/codeman continue <text>` | Resumes a blocked or unfinished task with a new run count. The text is optional guidance for the agent. |
| `/codeman set <name> <value>` | Changes `model`, `task-budget` or `max-runs` for this task from now on. The last valid one wins. |
| `/codeman model <id>` | Short for `/codeman set model <id>`. |

Text after `decide` or `approve` is not part of the command: the agent sees it later as a maintainer comment, but it is not recorded as an answer. Use `answer` or `replan` when the text matters.

Only comments from maintainers count, both for commands and for the text the agent sees. A maintainer is a user with `admin`, `maintain` or `write` access to the repository, read from `GET /repos/{owner}/{repo}/collaborators/{user}/permission`. The `author_association` field is not used: GitHub computes it for the reader, and an App token sees private organization members as `CONTRIBUTOR`. Answers are recorded in the status comment and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`. A `replan` in a batch of new commands wins: the run plans again instead of only recording answers.

## Status comment

Codeman keeps one comment per task up to date: state, plan and pull request links, decisions, answers, the agent's last report, problems and the model. A hidden block in it stores the task record (branch, plan path, decisions, answers, last handled comment and review, pull request, runs in a row). Codeman reads that block only from comments written by its own GitHub App, because anyone can post a comment containing it.

Text written by the agent or by users is rendered as inert Markdown: no HTML, links, images or formatting, and no @mentions. Short fields are collapsed to one line; the agent's report keeps its line breaks, so its lists survive.

## Untrusted input

Repositories may be public, so issue and comment text from non-maintainers is untrusted, and so is everything the agent produces.

- Comments from non-maintainers are dropped before anything reads them.
- The agent's task file marks issue text as data and wraps it in markers with a random nonce.
- Untrusted text is collapsed to one line, or prefixed, before it is logged, so it cannot inject workflow commands such as `::add-mask::`.
