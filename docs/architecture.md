# Architecture

Codeman is a GitHub Action written in TypeScript. A workflow in the target repository runs it; see [installation](installation.md). The workflow template is [`templates/codeman.yml`](../templates/codeman.yml). Its logic reaches GitHub only through interfaces, so other platforms can be added; see [platforms](#platforms).

## Tasks and states

A task is an open issue with the `codeman` label, opened by a maintainer. A maintainer applies the label to opt in; Codeman ignores everything else. (Pull requests are not handled yet.) A labeled issue that a maintainer did not open is left alone, and its status comment says why; see [untrusted input](security.md#untrusted-input).

Each task has at most one state label. A task without one has not started yet (`new`).

| Label | Meaning |
| --- | --- |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; the next run starts the next stage. |
| `codeman:designing` | The design stage is working. |
| `codeman:coding` | The code stage is working. |
| `codeman:testing` | The test stage is working. |
| `codeman:reviewing` | The review stage is working. |
| `codeman:in-progress` | Left from before stages: the task goes on in the code stage. |
| `codeman:awaiting-workflow` | Waiting for workflows the agent asked for; see [on-demand workflows](#on-demand-workflows). |
| `codeman:blocked` | Needs human attention; the status comment says how to go on (usually `/codeman continue`), and the last run comment says why. |
| `codeman:done` | Reviewed; the pull request is ready for a human review. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

## Runs

- Triggers: a daily schedule, `workflow_dispatch`, and `issue_comment` when the comment contains `/codeman` and its author is not a bot. Anyone can start a run this way, but `select` ignores comments from non-maintainers, so the run finds nothing new to do.
- Reviews also trigger a run: `pull_request_review`, on a pull request from a `codeman/` branch of the same repository, when the review requests changes or mentions `/codeman`. A review event runs the workflow file of the pull request's branch, which may be older than the default branch's, so its only job, `forward-review`, starts the default branch's workflow with `workflow_dispatch`. It holds no secrets; its `GITHUB_TOKEN` has `actions: write` only.
- Only one run per repository is active (`concurrency`). GitHub keeps at most one queued run and replaces older queued runs.
- Each run reads the state of every task from GitHub instead of reacting only to the event that started it. A replaced or failed run therefore loses no work; the next run picks it up.
- When a run moved a task (it recorded answers, or the agent ran), the `next-run` job starts another run with `workflow_dispatch`, carrying over a manual run's inputs. That run's `select` picks the next task, or stops without an LLM when none can move. Runs without a key (monthly budget reached, or the key job failed) start no other run, because the same task would be picked again without moving. The loop is bounded by the budgets, `max-runs` and the states: tasks that are blocked, done or awaiting an answer never start a run.
- Each run works on one task. Accepting workflows and recording answers come first, because they need no LLM; then the oldest task that needs a plan; then the oldest task in a stage: resumed with `fix` or `continue`, or already in a stage, before `codeman:ready`.

## Jobs

Each stage of a run is its own job, so the workflow graph shows where a run is and where it stopped.

```
select ──▶ open-key ──▶ agent ──▶ close-key ──▶ apply ──▶ next-run
```

Jobs that do not apply to a run are skipped: a run that only records answers goes from `select` to `apply`.

| Job | Does | Credentials |
| --- | --- | --- |
| `select` | Reads the settings and `.codemanignore` from the default branch, picks the task and the action (`plan`, `implement` with its stage, `record`, `accept` or `none`), sets `codeman:planning` or the stage's label, and writes the task context (`task.json`) as an artifact. | App token: issues write; contents, pull requests and actions read |
| `open-key` | Checks the task and monthly budgets and creates the run's OpenRouter key. | OpenRouter management key, encryption secret |
| `agent` | Runs the harness on a copy of the checkout and uploads what it changed as an artifact, even when the agent fails or runs out of time. | `GITHUB_TOKEN` with contents and actions read (for workflow results; the agent never sees it), the run's key |
| `close-key` | Disables the run's key and reads what it and each earlier run of the task spent. Runs whatever happened before. | OpenRouter management key |
| `apply` | Validates the agent's result and writes it: commits, pull request, labels, run and status comments, spend. When the action is `record`, it applies the maintainers' answers instead; when it is `accept`, it moves the accepted workflows. | App token: contents, issues and pull requests write; for `accept` only, a second token with contents and workflows write |
| `next-run` | Starts another run when this one moved a task. | `GITHUB_TOKEN` with `actions: write` |

Only `agent` runs an LLM. The jobs that write to GitHub never run one, and they treat everything the agent produced as untrusted.

## Agent sandbox

The agent reads text that may be hostile (see [security](security.md#risks)) and runs shell commands. It runs as `codeman-agent`, a user without `sudo`, on a copy of the checkout in that user's home.

- It cannot read the runner's processes, so it cannot reach the job's tokens or the secrets of other steps.
- The runner's home, which holds the job's temporary files, is closed to other users before the agent starts. The agent is not in the `docker` group.
- Its environment is rebuilt from an allowlist: its own `HOME` and XDG directories, the job's `PATH` without entries in the runner's home, and the harness's variables. Nothing else from the runner passes, including what `sudo`'s PAM session adds from `/etc/environment`.
- Its tools and network are not restricted: it can use what the runner image has and what earlier steps of the job set up. The sandbox protects credentials, not the runner.
- The task key reaches it only through its environment. It is the only credential the agent holds.
- When the harness exits or reaches its time limit, every process of that user is killed.
- Codeman finds changes with `git status`, using the original checkout's `.git` against the agent's copy; the agent's `.git` is never used. Changed files are copied without following symlinks.

## Agent rules

Every agent run gets Codeman's working rules: the `##` sections of Codeman's own [`AGENTS.md`](../AGENTS.md) (language, documentation, plans, commits, third-party code, decisions), after a short section on applying them without a person to ask. The agent job writes them to `.codeman/rules.md` in the agent's copy, and the harness loads that file as instructions next to the repository's `AGENTS.md` (OpenCode: the `instructions` setting). The repository's files are not changed.

- The repository's `AGENTS.md` (or `CLAUDE.md`) wins for its own conventions, such as where documentation lives or which language it uses. The rules in the task file always hold: plan path and format, output file, protected paths, no secrets.
- A section the repository's file already contains is left out: when 60% or more of its three-word sequences appear there, ignoring case and punctuation. So a repository that copied Codeman's `AGENTS.md`, even with edits, does not get it twice. The job's log lists the sections left out.

## Budget

- The task budget (default US$ 2) covers the whole task, from the first plan to the last fix, across all its runs.
- Each run gets its own OpenRouter key, expiring after 24 hours. Keys are named `codeman/<owner>/<repo>/<issue>/<run>` and are disabled, not deleted, so their usage still counts.
- Before creating a key, `open-key` adds up the total usage (`usage`) of the task's keys (prefix `codeman/<owner>/<repo>/<issue>/`). The new key's limit is what remains, in whole cents rounded down. Below US$ 0.10 no key is created, and the task becomes `codeman:blocked`; a maintainer can raise the budget with `/codeman set task-budget <usd>` and then comment `/codeman continue`.
- `open-key` also adds up this month's usage (`usage_monthly`) of every key with the repository's prefix. If the run's limit would take it past the monthly budget (default US$ 20), no key is created and the task goes back to its previous state until the next month.
- After the agent, `close-key` disables the key and reads its final usage, waiting briefly while OpenRouter still counts the last requests. The key's usage may still read zero when the analytics already has the run's tokens; then it waits up to about a minute more. It also lists the task's keys and reports what each run spent, by run ID (the end of the key's name). `apply` takes the task's total from that list, refreshes the cost of each row in the spend table, so a run that read its cost too soon gets it right on the next run, shows what the task spent at the end of the pull request's description, and keeps the task's total in the task record.
- The status comment has a spend table, with one row per run that used the agent: when, stage, model, how long the agent ran, input and output tokens, cost, the key's limit, the task budget, and the monthly budget with what the repository had spent this month before the run. Under it go the task's spend and its total tokens and agent time. Each run comment shows its own row. The record keeps the last 30 rows; older ones fold into one, with their sums, and their costs are no longer refreshed. A run with several rows (a re-run of the whole workflow) keeps them as they are. The task's total comes from OpenRouter, so when the rows add up to less (a run whose `apply` failed has no row), a last row shows the difference.
- The agent job measures the agent's time outside the sandbox. `close-key` reads the key's tokens from OpenRouter's analytics (`POST /api/v1/analytics/query`, filtered by the key's hash), as OpenRouter counts them: input includes cached prompt tokens, and output is the completion tokens. Analytics and billing may count a request at different times, so it asks again for up to about a minute; a run whose tokens are not there by then shows "—".
- Values passed between jobs appear in plain text in the logs of the job that reads them. `open-key` therefore passes the key encrypted with AES-256-GCM, using a key derived from `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`.

## Planning

1. `select` picks a `new` task, one left in `planning` by an interrupted run, or one with a `/codeman replan` request, and chooses the branch `codeman/<issue>-<slug>` and the plan path `docs/plans/<date>-<slug>.md`.
2. `agent` gives the harness a task file with the rules, the issue and the maintainer comments. The agent writes the plan and `.codeman/output.json`, which lists the decisions: a title, a question, options and a recommendation each. See [agent output](#agent-output) for its limits.
3. `apply` accepts only the plan file; other changes are ignored and listed in the run comment. It validates `output.json` strictly, commits the plan to the task branch through the Git Data API, and sets `codeman:awaiting-decision`, or `codeman:ready` when there are no decisions.

A revised plan (`/codeman replan`) keeps the decisions settled so far, with their numbers and answers, and the agent numbers its new decisions after every earlier one, so one number never means two decisions. The plan's `## Answers` section lists the settled answers from the start. The task record keeps its history: the spend table, the pull request, the handled accepts, the stages' reports and the suggested squash message. What starts over is the stages' progress, from design, and the decisions comment: the revised decisions get a new one, after the run comments before it, unless the revised plan has none.

If the agent fails, runs out of time or produces an invalid result, the task becomes `codeman:blocked`.

## Stages

After planning, a task goes through four stages, one run and one agent each, in order: design, code, test and review. Each stage's agent first decides whether its stage has work; when it does not, it reports `skipped` with the reason, and the next run starts the next stage.

| Stage | Does |
| --- | --- |
| Design | Flowcharts in Mermaid (`docs/flows/*.md`), screen drafts in plain HTML (`docs/design/*.html`) and their images (`docs/screenshots/*.png`, rendered with the runner's headless Chrome), linked from the plan. It may ask the maintainers decisions, such as a choice between two layouts. |
| Code | The implementation, with unit tests for the code it writes, and the documentation it changes. |
| Test | Integration and end-to-end tests where they apply, more unit tests where coverage is thin, and every check the repository has. What can only be tested outside the task branch (a deploy, a release) goes in a "Manual tests" section of its report, which the pull request's description shows; it is no reason to block. |
| Review | A critical review against the plan and the decisions, and a merge of the default branch in its sandbox to find conflicts and integration problems early. It changes nothing; its report goes on the pull request. It is not an approval to merge. |

1. `select` picks the task and its stage (the task record keeps it; a `fix` request always goes to code), and sets the stage's label. The agent starts from the head of the task branch, with the default branch's history, and gets the notes the previous stage left.
2. The agent writes `.codeman/output.json`: a status, a summary and, when it changed files, a commit message. Each stage may report only some statuses: `done`, `skipped`, `partial` (more work for another run of the same stage), `blocked`, `awaiting-workflow` (code and test), `decisions` (design and review) and `changes` (review).
3. `apply` filters the changes through the [change policy](#change-policy) and commits the rest to the task branch through the Git Data API, even when the agent failed or ran out of time, so no work is lost. Review's changes are discarded.
4. Then, by status:
   - `done` or `skipped`: the next stage runs next, with this stage's summary (or reason) as its notes. When code ends, Codeman opens the pull request as a draft, titled like the issue (`Closes #<issue>`, the plan's summary, and the code stage's commit message as the suggested squash message), so the repository's CI runs during test and review. Repositories without draft pull requests get a regular one.
   - `done` from review: Codeman adds its proposed `.codemanignore` if the repository has none, updates the pull request's description, marks it ready for review, posts the review report on it, and sets `codeman:done`. While the agent's workflows are still staged, the task waits for them to be accepted instead, and the pull request stays a draft; see [on-demand workflows](#on-demand-workflows).
   - `changes` from review: the report goes on the pull request, and the code stage works on it next. After `max-runs` rounds in a row, the task becomes `codeman:blocked`.
   - `decisions`: the task becomes `codeman:awaiting-decision`, with the new decisions after the plan's. When they are answered, design goes on; after review, code does, with the review's report.
   - `partial`, or out of time: the stage runs again, up to `max-runs` runs in a row. Then the task becomes `codeman:blocked`, and a maintainer can grant another round with `/codeman continue <guidance>`.
   - `blocked`, or an invalid result: `codeman:blocked`, with the reason. `/codeman continue <guidance>` tries the stage again, and so does accepting the task's staged workflows. When the agent reported `blocked`, the run comment also suggests `/codeman replan`: a request the plan does not cover, such as a `fix` that widens the task's scope, needs a revised plan.

### Feedback

After the pull request is open, maintainers ask for changes in either of these ways:

- a review that requests changes; its text is the request;
- `/codeman fix <what to change>` in a comment on the pull request or the issue, or in a review's text.

The task goes back to the code stage (`codeman:coding`) with a new run count, then through test and review again. The agent gets the requests and every maintainer review since the last run that handled reviews, with the line comments and their file and line. It pushes to the same branch, and when review passes again, Codeman updates the pull request's description. `/codeman replan` also works on the pull request.

Codeman records the last comment and review it handled. A request is handled once a run for it ends, whatever the outcome, so a failing request does not start run after run; when the monthly budget stopped the run from starting, the request waits for a later run.

## Agent output

The agent reports in `.codeman/output.json`: a summary and decisions when planning, and a status, a summary, a reason, a commit message and decisions in a stage. What it writes there ends up in comments on GitHub, which hold at most 65,536 characters, so each text has a limit; see [settings](#settings).

- The prompt states the limits. Codeman accepts each text up to twice its limit, without telling the agent: LLMs count characters poorly, and a text a little too long is not worth losing a run. The commit message's limit is 1,000 characters.
- Counts have no margin: at most `max-decisions` decisions, with 2 to `max-options` options each.
- All decisions of one output together (titles, questions and labels) may have at most 50,000 characters; the agent is told 25,000.
- When the harness exits, the agent job checks the output as `apply` will. If it is missing or invalid, or a text would be cut, and at least two minutes are left, it continues the agent's session once with the problems, stated with the limits the agent was told. A fix that fails or runs out of time leaves the first outcome.
- `apply` validates the output again. A text still longer than twice its limit is cut, and the run comment lists it under Problems. Any other problem blocks the task.

## Change policy

Apply commits only regular files that pass these rules; it drops the others and lists them in the run comment.

- `.codemanignore` at the repository's root lists the paths the agent may not change, in `.gitignore` syntax. `!` re-allows a path. A file inside an excluded directory cannot be re-allowed: to re-allow a whole subdirectory, add both `!/dir/sub/` and `!/dir/sub/**`.
- Without that file, Codeman uses its own rules: `/.github/**`, the harness's configuration (`opencode.json`, `opencode.jsonc`, `/.opencode/**`) and agent instructions (`AGENTS.md`, `CLAUDE.md`, `/.claude/**`, `/.agents/**`). Its first pull request proposes them as the repository's `.codemanignore`. Agent instructions are protected because later runs would follow a changed version before anyone reviewed it.
- When the repository's file stops protecting one of those paths, `select` warns in the run's summary.
- Whatever the file says, the agent never changes `.codemanignore` or `.codeman/`, since it must not change its own rules.
- Workflow files are never committed where they would run; see [on-demand workflows](#on-demand-workflows). The proposed rules protect all of `.github/`. To let the agent write workflows while keeping the rest of `.github/` protected, use `/.github/**`, `!/.github/workflows/` and `!/.github/workflows/**`.
- The plan file is always accepted.
- Each file may have at most `max-file-bytes`. A run that changes more than `max-files` files commits nothing and blocks the task.

Codeman reads the rules from the default branch, never from the task branch, so one run cannot loosen them for the next. Matching uses `git check-ignore` in an empty repository, so git's own rules apply.

## On-demand workflows

A workflow file runs as soon as it reaches a branch, if it listens to `push`, and on pull requests from the same repository, and it gets the repository's secrets. So Codeman never lets a workflow the agent wrote run before a maintainer reads it.

- When the agent writes or changes a file directly under `.github/workflows/`, and `.codemanignore` allows it, apply commits it to `.codeman/workflows/` on the task branch instead, where it does not run. The status comment lists these files. Deleting a workflow is left to a maintainer.
- After reading them in the pull request or on the branch, a maintainer comments `/codeman accept-workflows`. The next run moves them into `.github/workflows/` with a token that may write workflows, which apply requests only for this. If a staged file changed after the comment, nothing moves, and the maintainer must read them again and comment again. Codeman records the accepted comment, and the commit names who accepted.
- A workflow can be what the task delivers (a deploy workflow, for example), or something the agent needs: another operating system, a device, a secret. In that case the agent writes a workflow that runs on pushes to the task branch and reports `awaiting-workflow`, with the workflows it waits for. The task becomes `codeman:awaiting-workflow`. The agent never waits for a workflow that deploys, publishes or releases: from the task branch, it would ship work nobody reviewed.
- A stage that waits for workflows that are still staged does not stop the task: they cannot run before a maintainer accepts them. The stage records the wait, and the task goes on to the next stages and review. Review also checks the staged workflows as workflows: triggers, `permissions`, secrets only through a GitHub Environment, actions pinned to a full commit SHA, and `paths` filters and no deploy for a workflow that runs on the task branch. If it asks for changes, the code stage makes them. If it passes while workflows are still staged, the task becomes `codeman:awaiting-workflow` until they are accepted, and the pull request stays a draft, since merged from `.codeman/workflows/` they would never run.
- After that accept, a stage that waited for their runs waits for them, then goes on with their results, and the stages after it run again. If no stage waited, the task is done and the pull request becomes ready for review. The accept moves only files that did not change since review read them.
- A workflow the agent waits for includes its own file in its `paths` filters, so the push that accepts it runs it. Codeman looks for the runs on the branch's head, so a later commit that the filters skip leaves the task waiting; `/codeman continue <guidance>` goes on without them.
- Accepting workflows of a blocked task resumes the stage that blocked, with a new run count. The stage's agent is told which workflows were accepted, and by whom.
- Once accepted, the workflow runs on the push that moved it. When every awaited workflow has a finished run on the branch's head, the next run resumes the task. The agent job downloads each run's job conclusions, the last 64 KiB of the log of each job that did not succeed, and the artifacts, up to 50 MiB in total; the agent finds them in `.codeman/results/`. They came from code on the branch, so the agent treats them as data. `/codeman continue <guidance>` resumes the task without waiting.
- A workflow that needs secrets should take them from a GitHub Environment with required reviewers, so a human also approves each run.

## Settings

Each value comes from the first of these that sets it:

1. A `/codeman set` command on the task, in a comment or in the issue's description (only `model`, `task-budget`, `max-runs` and `language`).
2. The workflow's inputs, in a manual run.
3. `.codeman/settings.yml` on the default branch.
4. Codeman's default.

| Name | Default | Meaning |
| --- | --- | --- |
| `model` | none; required | OpenRouter model ID |
| `task-budget` | `2` | Spending limit of each task, across all its runs, in USD |
| `monthly-budget` | `20` | Spending limit per calendar month for the repository, in USD |
| `max-runs` | `3` | Implementation runs in a row without finishing before a task is blocked |
| `max-files` | `300` | Files one run may change |
| `max-file-bytes` | `1048576` | Size limit of each changed file |
| `max-decisions` | `10` | Decisions in one output of the agent, at most 10 |
| `max-options` | `4` | Options of each decision, from 2 to 6 |
| `max-title-chars` | `80` | Characters of a decision's title, at most 200 |
| `max-question-chars` | `600` | Characters of a decision's question, at most 1,500 |
| `max-label-chars` | `150` | Characters of an option's label, at most 300 |
| `max-summary-chars` | `2000` | Characters of the agent's summary and reason, at most 4,000 |
| `language` | `auto` | The language Codeman talks to maintainers in, as a BCP 47 tag such as `pt-BR`; `auto` uses the conversation's. See [conversation language](#conversation-language) |

The `max-*-chars` and count limits are what the agent is told; see [agent output](#agent-output) for the margin.

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
| `/codeman accept-workflows` | Moves the workflows the agent staged under `.codeman/workflows/` into `.github/workflows/`, after a maintainer has read them. See [on-demand workflows](#on-demand-workflows). |
| `/codeman continue <text>` | Resumes a blocked or unfinished task with a new run count. The text is optional guidance for the agent. |
| `/codeman set <name> <value>` | Changes `model`, `task-budget`, `max-runs` or `language` for this task from now on. The last valid one wins. |
| `/codeman model <id>` | Short for `/codeman set model <id>`. |

The issue's description may also hold `set` and `model` lines, to choose settings when opening the issue. Comments come after it, so a `set` in a comment wins. The agent reads the description without its command lines. Any other command in the description is a problem. Problems in the description, including invalid settings, are reported in every run while the description has them. The description does not start a run.

Text after `decide` or `approve` is not part of the command: the agent sees it later as a maintainer comment, but it is not recorded as an answer. Use `answer` or `replan` when the text matters.

Only comments from maintainers count, both for commands and for the text the agent sees, and only issues they opened are tasks. A maintainer is a user with `admin`, `maintain` or `write` access to the repository, read from `GET /repos/{owner}/{repo}/collaborators/{user}/permission`. The `author_association` field is not used: GitHub computes it for the reader, and an App token sees private organization members as `CONTRIBUTOR`. Answers are recorded in the status comment and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`. A `replan` in a batch of new commands wins: the run plans again instead of only recording answers.

## Status and run comments

Codeman keeps one status comment per task up to date, as the task's panel: where the task is now and what comes next, plan and pull request links, a link to the decisions, workflows to review, the task's spend, the model, and links to the last run and its report. A hidden block in it stores the task record (branch, plan path, decisions, answers, last handled comment and review, pull request, runs in a row, spend), gzip-compressed and in base64url, because the comment holds at most 65,536 characters. Records written before compression are still read. Codeman reads that block only from comments written by its own GitHub App, because anyone can post a comment containing it.

Once a task has decisions, a decisions comment shows them, with the recommendations, the answers and how to answer. Codeman renders it from the task record, edits it in place, and never reads it back: the record stays the only state, and an update that fails is repaired by the next one. The record keeps its ID; if it was deleted, Codeman posts a new one. A revised plan's decisions get a new comment, and the earlier one stays as it was; when a revised plan has no decisions, the earlier comment says so. Tasks from before this comment existed get it in their next run.

No comment Codeman writes exceeds the platform's limit: 65,536 characters on GitHub. When the decisions do not fit, answered ones are shown in one line each, then left out, then pending ones from the last, with a note that the plan has them all. When the panel does not fit, it keeps its record and links and leaves out the rest, with a note.

Each run that moves the task also posts a new comment on the issue, so the issue keeps the task's history in order: its title says what the run worked on (the plan, a stage, recorded answers or accepted workflows) and how it ended (such as "Design stage: skipped"); then come the agent's report, problems, what comes next (the next stage, the maintainers' decisions, accepting workflows, a maintainer, or reviewing the pull request), and what the run spent. A run that only waits to try again later, because the monthly budget is reached, updates the panel only.

Each stage's agent reads Codeman's earlier run comments on the task, oldest first, up to 20,000 characters (older ones are dropped first). Only comments by the App with the run marker count, and the agent treats them as data: the agents that wrote them read untrusted text.

Text written by the agent is rendered as safe Markdown: emphasis, code, lists, quotes and tables work, but HTML is escaped, links and images show as their text followed by the URL, and @mentions and issue references are broken with an invisible space, so they notify and link nothing. Its headings are lowered to level 5, so it cannot imitate Codeman's own, and a code block it leaves open is closed. Short fields stay on one line. Text written by users, such as free-text answers, is rendered fully inert.

## Conversation language

Codeman talks to maintainers in the task's language: the fixed texts of the status and run comments, the pull request's description and review comments, and what the agent writes for them (summaries, reasons, decisions, reports). Code, comments, commit messages and documentation, the plan included, follow the [agent rules](#agent-rules) instead.

- With `language: auto` (the default), the planning agent reports the conversation's language, from the issue and the maintainer comments, and the task record keeps it. Until then, Codeman writes in English. Any other value of `language` wins over the reported one.
- Fixed texts come from catalogs in `src/i18n/`: English and Brazilian Portuguese. A language without a catalog uses its base language's (`pt-PT` uses Brazilian Portuguese), or else English. Numbers and dates follow the language.
- Commands, labels, file paths, the workflow's logs and technical details of an invalid agent result stay in English.
- The pull request's title is the issue's title.

## Platforms

The steps reach the platform and the runtime only through interfaces. GitHub and GitHub Actions are the only implementations so far; [`src/main.ts`](../src/main.ts) wires them into `Services`, which each step takes. Tests run `select` and `apply` on an in-memory platform unlike GitHub ([`src/testing/`](../src/testing/)).

| Interface | Covers | GitHub implementation |
| --- | --- | --- |
| `Platform` ([`src/platform/platform.ts`](../src/platform/platform.ts)) | Tasks and their state labels, comments on issues and on change requests, change requests and their reviews, who is a maintainer, the account Codeman writes as, files and commits, links and references. | [`src/platform/github/platform.ts`](../src/platform/github/platform.ts): the REST and GraphQL APIs, through the App's token. |
| `CiResults` | Runs of CI on a commit, their jobs, logs and artifacts. | [`src/platform/github/ci.ts`](../src/platform/github/ci.ts): GitHub Actions. |
| `Conventions` ([`src/platform/conventions.ts`](../src/platform/conventions.ts)) | The Markdown dialect (mentions and references to break), the comment size limit, where CI configuration lives, the rules that protect it, and what the agent is told about writing and reviewing it. | [`src/platform/github/conventions.ts`](../src/platform/github/conventions.ts). |
| `Runtime` ([`src/runtime/runtime.ts`](../src/runtime/runtime.ts)) | Inputs and outputs of a step, logs, the run's summary, secret masking, the workspace, the run's ID and link, and the repository. | [`src/runtime/github-actions.ts`](../src/runtime/github-actions.ts). |

Every adapter must guarantee:

- **Ordered IDs.** Comment and review IDs are numbers that grow with time within an issue or change request: Codeman marks requests as handled by the highest ID it has read. A platform without them, such as reviewer votes, synthesizes them.
- **An identity nobody else has.** `self()` names an account only Codeman can post as. The task record and the run history are read only from its comments.
- **A real maintainer check.** `isMaintainer` reads the platform's permissions (write access or more), never what a user or a comment claims.
- **Comments kept as written.** The task record lives in a hidden HTML comment inside the status comment, so the platform must keep Markdown as written, HTML comments included, up to its `commentLimit`, which must be at least 65,536 characters: the agent's output limits are set for it.
- **Atomic, guarded commits.** `commit` writes all changes at once, without running git on the agent's files, and fails without writing if the branch moved since the base commit.
- **Safe Markdown.** The dialect matches every mention and reference the platform renders. This is a security boundary: a reference it misses lets the agent notify or link anyone.
- **Unambiguous key names.** OpenRouter keys are named `codeman/<owner>/<repo>/<issue>/<run>`. An owner of several segments, such as a group path, must not make one repository's name a prefix of another's.

The [security model](security.md) relies on GitHub Actions: credentials scoped to each job, secrets masked at runtime, and runs started by comments and reviews. Another runtime must provide each of these or an equivalent, and the security document must be reviewed for it before Codeman runs there.

