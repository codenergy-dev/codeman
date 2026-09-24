---
status: in progress
created_at: 2026-09-23T14:18:00-03:00
updated_at: 2026-09-24T15:00:00-03:00
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
- Only comments from users with `OWNER`, `MEMBER` or `COLLABORATOR` association count. Everything else is ignored.

### Permissions

- A GitHub App (`codeman[bot]`) with the minimum permissions: contents, issues, pull requests, workflows (write).
- The agent job runs with read-only access. It produces a patch and a list of declared outputs (comments, labels, pull request). A separate job without any LLM validates and applies them.
- The agent never pushes to the default branch. It works on `codeman/<issue-number>-<slug>` branches.
- Runner network egress is restricted to GitHub and OpenRouter where possible.

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
- [x] For each opted-in issue without a plan: read the issue and repository, write `plans/YYYY-MM-DD-title.md` on the task branch, post the decisions as a comment, and set `codeman:awaiting-decision`.
- [x] Parse `/codeman` commands from authorized users; record answers in the plan; set `codeman:ready` when none remain.
- [x] Prompt-injection tests: issues and comments from unauthorized users must not change behavior.

Done when: on the test repository, an ambiguous issue gets a plan and relevant decisions, and answering them moves it to `codeman:ready`. No code is written in this step.

Result: implemented and unit-tested; the sandbox test runs in CI. The end-to-end check on the test repository is pending.

### 3. Implementation

- [ ] For `codeman:ready` tasks: implement on the task branch, update `docs/`, keep the plan current.
- [ ] Extend the apply job to validate and push code changes (the jobs are split in step 2).
- [ ] Open a pull request linked to the issue, with a suggested commit message and a summary of the plan.
- [ ] Handle pull request review comments as new decisions or follow-up work.

Done when: a simple issue goes from opt-in to an open pull request that passes the repository's CI.

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