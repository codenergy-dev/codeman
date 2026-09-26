---
status: in progress
created_at: 2026-09-23T14:18:00-03:00
updated_at: 2026-09-26T11:00:00-03:00
commit: null
---

# Codeman MVP

## Goal

Build Codeman, a GitHub Action that runs an AI agent on a repository to work on issues and pull requests. The agent asks a human to make the relevant decisions before acting, then implements the work and opens a pull request for review.

## Context

Most coding agents start writing code straight from an issue. When the issue is ambiguous, the result is a pull request that must be reviewed, rejected and redone. Codeman turns ambiguity into explicit questions on the issue first, which is cheap and auditable.

Differentiators to protect:

1. Planning with explicit decisions before any code.
2. Model-agnostic via OpenRouter, with a disposable, budget-capped API key per task.
3. On-demand workflows written by the agent and approved by a human, for heavy or sensitive work (e.g. macOS for the iOS simulator).

Constraints:

- Codeman must follow `AGENTS.md` in the repositories it runs on. In an unattended run, "authorization" means an approved decision on the issue and, for any change, a human merging the pull request.
- Repositories may be public. Any text written by non-maintainers is untrusted input.
- The `GITHUB_TOKEN` cannot push changes under `.github/workflows/`, and events it creates do not trigger other workflows (except `workflow_dispatch` and `repository_dispatch`). A GitHub App is required.
- GitHub Actions artifacts expire, so they cannot hold long-term memory.

## Decisions

Answer these before step 1 starts.

1. **Agent harness.** Options: (a) write our own agent loop against the OpenRouter API; (b) wrap an existing open-source CLI agent that supports OpenRouter. Trade-off: (a) is more work but fully auditable and small; (b) is faster but adds a large third-party dependency with broad permissions. Recommendation: (a), keeping the tool set minimal (read, search, edit files, run commands in the workspace).
   **Answer:** (b), using OpenCode by default. Codeman talks to the harness through a small interface so other harnesses can be added later. Use OpenCode v1 (`opencode-ai`); v2 (`@opencode/cli`) is still a preview without tagged releases. The dependency audit is in `docs/dependencies.md`.
2. **Implementation language and action type.** Options: TypeScript JavaScript action, or a Docker container action. Recommendation: TypeScript action; it starts fast, runs on every runner OS, and uses GitHub's official toolkit.
   **Answer:** TypeScript action.
3. **Project documentation.** `AGENTS.md` makes `docs/` the single source of truth, while lat.md uses a `lat.md/` directory. Options: (a) plain markdown in `docs/`; (b) adopt lat.md and accept a second directory; (c) adopt lat.md only if it can be configured to use `docs/`. Recommendation: (a) for the MVP, revisit after step 4.
   **Answer:** (a). Measure how well `docs/` works as the tool evolves; try lat.md or another approach later if it falls short.
4. **Long-term memory.** Options: (a) no separate memory for the MVP (issues, plans and `docs/` only); (b) ai-memory, persisted on an orphan branch. Recommendation: (a). ai-memory is a persistent server built for multi-agent, multi-machine handoff; on an ephemeral runner it would need to be restored and saved on every run. Add memory only when a concrete gap appears.
   **Answer:** (a), `docs/` only. ai-memory or another agent memory may be tested later if needed.
5. **Trigger model.** Options: (a) daily cron only; (b) cron plus `issue_comment` events from authorized users. Recommendation: (b). With cron only, each question and answer costs a full day.
   **Answer:** cron, `workflow_dispatch` and `issue_comment`.
6. **Budget defaults.** Proposed defaults: per-task key limit of US$ 2 expiring in 24 hours, a monthly cap per repository, and a maximum of 50 agent iterations per run. Confirm or adjust.
   **Answer:** per-task key limit of US$ 2 expiring in 24 hours and a monthly cap per repository. No iteration limit: the harness manages its own iterations. Jobs time out after 60 minutes; unfinished work is pushed to the task branch so the next run continues from there (see Budget).

Answer these before step 2 starts.

7. **OpenCode version.** CVE-2026-88624 (path traversal in the local server's `DELETE /experimental/worktree`) still has no fixed version; the latest release is 1.18.32. Options: (a) pin 1.18.32 now and upgrade when a fix ships; (b) wait for a fix. Recommendation: (a). The endpoint lets a caller delete directories, and in Codeman the only process that can reach it is the agent, which already runs shell commands on a disposable runner with no write token. The flaw adds no new capability there.
   **Answer:** (a), pin 1.18.32.
8. **Agent and apply split.** Step 3 splits the run into a read-only agent job and an apply job, but step 2 already writes a plan file and posts comments. Options: (a) do the split in step 2; (b) give the agent the App token in step 2 and split in step 3. Recommendation: (a). The agent reads issue text that may be untrusted and can run shell commands, so it could read any token in its job.
   **Answer:** (a), with the work split into separate jobs so the workflow graph shows each stage of the loop. Values passed between jobs appear in plain text in the logs, so the task key travels encrypted with a second secret (`CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`). The management key never enters the agent job, and the agent runs as an unprivileged user without `sudo`.
9. **Monthly cap per repository.** OpenRouter keys support `limit` (USD) and `expires_at`, but the usage of a deleted key is lost, so a monthly total cannot be computed. Options: (a) disable task keys at the end instead of deleting them, name them `codeman/<owner>/<repo>/<issue>/<run>`, and add up this month's usage of the keys for the repository before creating a new one; (b) keep deleting keys and drop the monthly cap. Recommendation: (a). Also choose the default monthly cap; it is an action input, so each repository can change it.
   **Answer:** (a), default US$ 20 per month. The workflow template exposes the model and the budgets as `workflow_dispatch` inputs, with defaults for scheduled and comment runs. OpenRouter reports `usage_monthly` per key, so the total is the sum of that field over the repository's keys, including disabled ones.
10. **Model.** Options: (a) a required `model` input with no default, so each repository chooses; (b) a default model in Codeman. Recommendation: (a), which keeps Codeman model-agnostic and avoids a default that goes stale.
   **Answer:** (a). The template sets the model the repository uses by default, and a maintainer can choose the model for one task with `/codeman model <id>`.
11. **Management key storage.** The OpenRouter management key can create keys without limits, so only the job that creates and disables task keys may read it. Recommendation: store it as `CODEMAN_OPENROUTER_MANAGEMENT_KEY` in a GitHub Environment named `codeman`, restricted to the default branch, and use that environment only in that job.
   **Answer:** the secrets and variables may live at organization level, visible only to selected repositories. Names: `CODEMAN_GITHUB_APP_CLIENT_ID`, `CODEMAN_GITHUB_APP_PRIVATE_KEY`, `CODEMAN_OPENROUTER_MANAGEMENT_KEY`, `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`. Only the key jobs reference the management key.
12. **Agent sandbox: ai-jail.** [ai-jail](https://github.com/akitaonrails/ai-jail) (GPL-3.0, Rust, v2.1.0) wraps bubblewrap, Landlock and seccomp, and can limit egress to listed hosts (`--allow-host`). Compared with the current unprivileged user, it hides the host filesystem and processes, and it can block the agent from sending repository contents anywhere but OpenRouter. Costs: two more dependencies (the ai-jail binary and the `bubblewrap` package); an AppArmor profile for `bwrap` on Ubuntu 24.04 runners; Linux x86_64 only; built for interactive use, with no stated CI support; and filtered egress has no DNS inside the sandbox, so OpenCode must honor `HTTPS_PROXY`. The license allows this use: Codeman runs the upstream binary as a separate program and does not distribute it. Options: (a) run a spike on a GitHub runner, then add ai-jail on top of the unprivileged user if it passes; (b) keep the unprivileged user only. Recommendation: (a).
   **Answer:** (b) for now. The priority is that the agent cannot reach secrets, credentials or other sensitive data; limiting its tools or network could keep it from doing legitimate work. Revisit in step 5, after mapping what the agent needs to work.
13. **Free-text answers.** Today only command lines count: text written next to `/codeman approve` is not recorded, and the agent sees it later only as a loose comment that may contradict the recorded answers. Options: (a) `/codeman answer <n> <text>` records a free-text answer to decision `n`, in place of an option; the text may continue on the following lines of the comment; (b) (a) plus `/codeman replan <text>`, which sends the task back to planning so the agent revises the plan and its decisions with the maintainers' comments; (c) keep options only. Recommendation: (b). `answer` covers a better answer than the listed options without an LLM; `replan` covers text that changes the scope, which only the agent can turn into a new plan.
   **Answer:** (b). Also, `decide` accepts `1 a` as well as `1=a`, several answers in one command (`1 a 2 b`), and several commands in one comment. Commands also work while the task is `codeman:ready`.

Answer these before step 3 starts.

14. **What the agent may change.** The apply job commits only what passes a policy. Options: (a) any path except protected ones: `.github/`, `.codeman/`, the harness configuration (`opencode.json`, `opencode.jsonc`, `.opencode/`), and agent instructions (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`); only regular files; at most 1 MiB per file and 300 files per run; (b) an allowlist of paths per repository. Recommendation: (a), with an input to protect more paths. Agent instructions are protected because later runs on the same branch would follow the changed version before any human reviewed it; a task that must change them can say so in the pull request.
   **Answer:** each repository decides, in a `.codemanignore` file at its root with `.gitignore` syntax, including `!` to re-allow a path. Apply drops every change that matches it. When the file is missing, Codeman proposes one with the protected paths of (a). The run summary warns about each of those paths that a repository's file no longer protects. File limits are optional settings in `.codeman/settings.yml`, which also holds fallbacks for the model and the budgets (see Settings).
15. **The project's tools.** The agent needs the repository's toolchain to build and test. Options: (a) the target workflow sets tools up in the agent job before Codeman (for example `actions/setup-node`), and Codeman passes that job's `PATH` to the agent, and nothing else from its environment; (b) the agent installs tools itself, without `sudo`; (c) a container image per repository. Recommendation: (a). It reuses the setup the repository's CI already has, and the template gets a marked place for it.
   **Answer:** do not restrict the agent's tools for now: GitHub's runners already have most of what projects need, and each project has its own needs. The agent gets the job's `PATH`, so it can use the runner's tools and any setup step in the agent job. Protecting secrets and sensitive data is the priority. Revisit tool access in step 5.
16. **Pull request and CI.** Options: (a) when the agent reports the work as done, open the pull request (not a draft), linked with `Closes #<issue>`, with the plan summary and a suggested squash commit message, and set `codeman:done`; a failing CI is handled like any review feedback (decision 17); (b) open a draft, watch CI in later runs, and mark it ready only when CI passes, retrying fixes automatically. Recommendation: (a) for the MVP. The prompt requires the agent to run the repository's tests and linters before it reports done; automatic CI fixing can come later, with evidence of how often it is needed.
   **Answer:** (a).
17. **Review feedback.** Options: (a) `/codeman fix <text>` on the pull request (a comment or a review body) sends the task back to `codeman:in-progress`; the agent gets the text and every maintainer review comment since the last run, with file and line, and pushes to the same branch; (b) any review that requests changes does the same automatically. Recommendation: (a). It is explicit, like the decisions protocol, and a review can hold several comments before work starts. `/codeman replan` also works on the pull request.
   **Answer:** (a) and (b): a maintainer review that requests changes also counts as a fix request, because it is the usual GitHub flow.
18. **Unfinished work.** Decision 6 pushes partial work when time runs out, and the next run continues. Options: (a) at most 3 implementation runs per task (or per `fix` request) before it becomes `codeman:blocked`; the limit is an input; (b) no limit besides the budgets. Recommendation: (a). A task that needs more than three runs is probably too big or stuck, and each run costs up to the task budget.
   **Answer:** a limit on consecutive runs, default 3, to stop endless retries. After that the task is `codeman:blocked`, and a maintainer can grant another round with `/codeman continue <text>`. The limit is a workflow input with a fallback in `.codeman/settings.yml`, and a maintainer can override it for one task with a command, as with the model.
19. **Chaining runs.** One run handles one task, so after `/codeman approve` the implementation waits for the next trigger (the daily schedule, a comment or a manual run). Options: (a) at the end of a run, if another task can move, `apply` starts the workflow again (`workflow_dispatch`, which needs `actions: write` for that job's `GITHUB_TOKEN`); (b) wait for the next trigger. Recommendation: (a). Approving and seeing the work start is the expected flow, and the budgets and states bound the loop: blocked, done and awaiting tasks never start a run.
   **Answer:** (a).

Answer these before step 3 starts. They follow from the answers to 14, 17 and 18.

20. **`.codemanignore` details.** Options: (a) apply reads `.codemanignore` and `.codeman/settings.yml` from the default branch, never from the task branch; the agent can never change `.codemanignore` or `.codeman/`, whatever the file says, since it must not edit its own rules; every other path in the proposed file can be removed, with a warning; when the file is missing, Codeman uses the proposed file and commits it to the task's pull request, so a human reviews it on merge; (b) the same, but every proposed path can be removed. Recommendation: (a). If the agent could edit the rules, or if they were read from its branch, one run could unlock the next. Changes under `.github/workflows/` also stay blocked in step 3 whatever the file says, because apply's token has no `workflows` permission; step 4 revisits this.
21. **Settings and overrides.** Options: (a) each value comes from, in order: a command on the task, the `workflow_dispatch` input, `.codeman/settings.yml`, Codeman's default (budgets US$ 2 and US$ 20, 3 runs; no default model, per decision 10). Settings use the input names: `model`, `task-budget`, `monthly-budget`, `max-runs`, `max-files`, `max-file-bytes`. The template stops writing its own defaults into the inputs, so the settings file takes effect, and the model moves to the settings file. `/codeman set <name> <value>` overrides `model`, `task-budget` or `max-runs` for one task; `/codeman model <id>` stays as a shortcut. The monthly budget covers the whole repository, so a task cannot change it; (b) keep the template defaults and use the settings file only for the file limits. Recommendation: (a).
22. **Trigger for reviews.** A review is not an issue comment, so decision 17 needs a new trigger. Options: (a) the template listens to `pull_request_review` (`submitted`); `select` runs only for reviews that request changes or contain `/codeman`, on pull requests whose branch lives in the same repository and starts with `codeman/`; (b) no new trigger: reviews wait for the schedule or a comment. Recommendation: (a). Reviews on pull requests from forks get no secrets, so the condition keeps those runs from failing.

Answers to 20, 21 and 22: (a), with the settings file in YAML: `.codeman/settings.yml`. It holds flat `name: value` pairs, so Codeman reads it with a small strict parser instead of a YAML dependency. The proposed `.codemanignore` writes directories as `dir/**`, so a repository can re-allow a file inside one with `!`.

## Design

### Task state

Each issue or pull request has exactly one state, stored as a label so the agent never has to infer it:

| Label | Meaning |
| --- | --- |
| `codeman` | Opt-in. Applied by a maintainer; Codeman ignores everything else. |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; next run implements. |
| `codeman:in-progress` | Agent is implementing. |
| `codeman:awaiting-workflow` | Waiting for an on-demand workflow to finish. |
| `codeman:blocked` | Needs human attention; reason in the plan. |
| `codeman:done` | Pull request opened. |

Each Codeman comment carries a hidden marker (`<!-- codeman:... -->`) linking it to the plan file and run.

### Decisions protocol

- The agent posts decisions as a numbered list, each with options and a recommendation.
- An authorized user answers with a command such as `/codeman decide 1=a 2=b`, or `/codeman approve` to accept every recommendation.
- Only comments from users with write access to the repository (`admin`, `maintain` or `write`) count. Everything else is ignored. (Changed from `OWNER`, `MEMBER` or `COLLABORATOR` association: an App token sees private organization members as `CONTRIBUTOR`, and `MEMBER` also covered members with read-only access.)

### Permissions

- A GitHub App (`codeman[bot]`) with the minimum permissions: contents, issues, pull requests, workflows (write).
- The agent job runs with read-only access. It produces a patch and a list of declared outputs (comments, labels, pull request). A separate job without any LLM validates and applies them.
- The agent never pushes to the default branch. It works on `codeman/<issue-number>-<slug>` branches.
- The agent's network is not restricted for now (decision 12).

### On-demand workflows

- The agent writes the workflow in its pull request. Merging is the approval.
- Jobs that need secrets use a GitHub Environment with required reviewers.
- When the workflow finishes, its result (logs and artifacts) is read by the next Codeman run, which resumes the task.

### Budget

At the start of each task, a job creates an OpenRouter API key with a spending limit and expiration through the management API, passes it to the agent job, and deletes it at the end.

### Time limit and partial work

- Jobs set `timeout-minutes: 60` as a hard limit.
- The action stops the harness at a soft deadline before that limit, so there is time to save the work.
- If the task is not finished, the agent job still produces its patch and a progress note in the plan. The apply job validates and pushes it to the task branch like any other patch, and the task keeps its current state.
- The next run starts from the task branch and the plan, not from scratch.

### Implementation loop

- A `codeman:ready` task moves to `codeman:in-progress`. The agent works on the task branch and writes `.codeman/output.json` with a status (`done`, `partial` or `blocked`), a summary and, when done, a squash commit message.
- Apply keeps the changes that pass the policy (`.codemanignore` and the file limits) and commits them to the task branch. The plan file is always accepted. Dropped changes are listed on the status comment.
- `done`: open the pull request and set `codeman:done`. `partial`: stay `codeman:in-progress` for the next run. `blocked`: set `codeman:blocked` with the agent's reason.
- Consecutive runs without `done` count toward `max-runs`. `/codeman continue <text>` and a fix request start a new count.
- Fix requests (`/codeman fix <text>` or a review that requests changes, by a maintainer) on the task's pull request send the task back to `codeman:in-progress`. The agent gets the text and the maintainers' review comments since its last run, with file and line.
- When a run ends and another task can move, apply starts the workflow again.

### Agent environment

- The agent gets the job's `PATH`, without entries in the runner's home, which the agent user cannot read. Tools installed there (for example Rust through `rustup`) must be installed system-wide by a setup step.
- The agent must not reach the job's tokens, the workflow's secrets, the runner's home or its temporary files, or the Docker socket. The sandbox test checks each of these on a GitHub runner.

## Steps

### 1. Foundation

- [x] Repository with `README.md`, `AGENTS.md`, `docs/` and `plans/`.
- [x] Action skeleton in the language chosen in decision 2, with pinned dependencies and CI (lint, tests, build).
- [x] GitHub App registered with the permissions above; installation documented in `docs/`.
- [x] Workflow template for target repositories: cron, `workflow_dispatch` and (per decision 5) `issue_comment`, with `concurrency` set so only one run per repository is active.

Done when: the action runs on a test repository, lists open issues labeled `codeman` and exits without changes.

Result (2026-09-24): done. On a private test repository, the action listed one opted-in issue in state `new` and changed nothing.

### 2. Planning only

- [x] Workflow split into jobs: `select` (pick one task, no LLM) → `open-key` → `agent` (read-only) → `apply` (validate and write), plus `close-key`, which always runs. One task per run.
- [x] Harness interface with an OpenCode adapter, using OpenRouter and a per-task, budget-capped key. OpenCode runs as an unprivileged user on the runner.
- [x] `/codeman model <id>` lets a maintainer choose the model for one task.
- [x] `/codeman answer <n> <text>` records a free-text answer; `/codeman replan <text>` sends the task back to planning with the answers given so far (decision 13).
- [x] For each opted-in issue without a plan: read the issue and repository, write `plans/YYYY-MM-DD-title.md` on the task branch, post the decisions as a comment, and set `codeman:awaiting-decision`.
- [x] Parse `/codeman` commands from authorized users; record answers in the plan; set `codeman:ready` when none remain.
- [ ] End-to-end check of decisions: partial `decide`, `answer`, `replan` and `approve` on the test repository.
- [x] Prompt-injection tests: issues and comments from unauthorized users must not change behavior.

Done when: on the test repository, an ambiguous issue gets a plan and relevant decisions, and answering them moves it to `codeman:ready`. No code is written in this step.

Result (2026-09-25): done. On a private test repository, an issue got a plan with four decisions, and `/codeman decide` moved it to `codeman:ready` with the answers recorded on the task branch. `answer` and `replan` are covered by unit tests; their end-to-end check is still open.

### 3. Implementation

Each part ends with an end-to-end check on the test repository.

3a. Implementation and pull request

- [x] Settings: `.codeman/settings.yml`, inputs and `/codeman set`, in the order of decision 21.
- [x] Implementation prompt and output (`done`, `partial`, `blocked`); the agent updates `docs/` and keeps the plan current.
- [x] Agent environment: the job's `PATH`; the runner's home closed to other users; sandbox test extended to the runner's home, temporary files and Docker socket.
- [x] Apply: `.codemanignore` policy and file limits; commit to the task branch, also when the agent fails or runs out of time; propose `.codemanignore` when missing; warn about removed protected paths.
- [x] Open the pull request (`Closes #<issue>`, plan summary, suggested squash message) and set `codeman:done`. The apply token gets `pull-requests: write`.
- [x] End-to-end check on the test repository: a simple issue reaches an open pull request.

Result (2026-09-25): done. On a private test repository, a `codeman:ready` issue was implemented in one run and got a pull request, and the issue moved to `codeman:done`. Fix after the check: the agent's report on the status comment now keeps its line breaks.

3b. Unfinished work and feedback

- [x] Consecutive run limit (`max-runs`) and `/codeman continue <text>`, which also replaces swapping labels to retry a blocked task.
- [x] `/codeman fix <text>` and reviews that request changes, with review comments in the prompt; `/codeman replan` on the pull request.
- [x] `pull_request_review` trigger in the template (decision 22). A review event runs the workflow file of the pull request's branch, which may be older than the default branch's; so the review run has one job, without secrets, that starts the default branch's workflow with `workflow_dispatch` (`actions: write` on its `GITHUB_TOKEN`, as decision 19 already grants for chaining).
- [x] A request is handled once its run ends, whatever the outcome, so a failing request cannot start run after run; a run stopped by the monthly budget leaves it for later.
- [x] End-to-end check on the test repository: a review that requests changes and a `/codeman fix` are applied to the pull request.

Result (2026-09-26): done. On a private test repository, a review that requested changes and a `/codeman fix` comment were both applied to the task's pull request. Fix found by the check: `select` needs `pull-requests: read` to list reviews. The first review did not start a run, because the pull request's merge ref still held the old workflow; it was handled by a manual run. After that, a review that requested changes started `forward-review`, which ran the workflow on its own.

3c. Chaining

- [x] Apply starts the workflow again when another task can move. The apply job's `GITHUB_TOKEN` gets `actions: write`.
  - Apply does not compute what can move; the next run's `select` does, and a run with nothing to do stops there without an LLM. So apply asks for another run whenever this one moved a task: after recording answers, or after the agent ran.
  - No new run when no key was created (monthly budget reached, or the key job failed): the same task would be picked again without moving, run after run.
  - The new run starts from a separate `next-run` job, so the graph shows it, with `actions: write` on its `GITHUB_TOKEN` and no secrets. A manual run's inputs carry over to the runs it starts.
- [ ] End-to-end check on the test repository: `/codeman approve` on a new plan leads to an open pull request without another trigger, and the chain stops with "Nothing to do".

Done when: a simple issue goes from opt-in to an open pull request that passes the repository's CI, and a fix request on that pull request is applied.

### 4. On-demand workflows

- [ ] Let the agent propose a workflow file inside its pull request, and set `codeman:awaiting-workflow`.
- [ ] Resume the task after the workflow run, using its logs and artifacts.
- [ ] Document Environments with required reviewers for workflows that need secrets.

Done when: an issue that requires a macOS runner completes end to end, with a human approving the workflow.

### 5. Review

- [ ] Run Codeman on two or three real repositories for a few weeks.
- [ ] Revisit decisions 3 (documentation) and 4 (memory) with evidence.
- [ ] Re-evaluate OpenCode v2 once it becomes the main release, with tagged releases traceable to source.
- [ ] Write a follow-up plan for anything that should change.

## Out of scope

- Support for platforms other than GitHub.
- A web dashboard; GitHub issues and pull requests are the interface.
- Automatic merging. A human always merges.
- Long-term memory beyond issues, plans and `docs/`, unless decision 4 says otherwise.
- Working on issues that a maintainer has not opted in.