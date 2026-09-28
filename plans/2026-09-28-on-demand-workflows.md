---
status: pending
created_at: 2026-09-28T11:00:00-03:00
updated_at: 2026-09-28T11:00:00-03:00
commit: 54cc1bb
---

# On-demand workflows

## Goal

Let the agent deliver GitHub Actions workflows safely: as part of a task (for example, a GitHub Pages deploy workflow), and as a way to run work it cannot do on its own runner (for example, a macOS build), with a maintainer approving every workflow before it runs.

## Context

This is step 4 of the MVP plan (`plans/2026-09-23-codeman-mvp.md`), moved here when the MVP closed.

Today apply drops every change under `.github/workflows/`, whatever `.codemanignore` says. Its token has no `workflows` permission, and GitHub rejects a commit that touches workflow files without it. On a private test repository, a task that asked for a GitHub Pages deploy workflow lost that file this way, even with the rule removed from `.codemanignore`.

Adding the permission is not enough, because of how workflows run:

- A workflow file on a branch runs as soon as it is pushed, if it listens to `push`.
- On a pull request from the same repository, `pull_request` runs use the workflow files of the pull request's merge commit, so a changed workflow runs too.
- Both get the repository's secrets.

So committing a workflow the agent wrote to the task branch runs agent-written code with the repository's secrets before any human reads it. The agent reads text that anyone may have written, so that is the path a prompt injection would take. The design must keep a human between the agent writing a workflow and that workflow running.

Two needs share this mechanism:

- **A. Workflows as deliverables.** The task itself asks for a workflow. It only has to reach the pull request for review.
- **B. Workflows the agent needs.** The agent needs a runner, platform or secret it does not have (a macOS runner for the iOS simulator, a device farm). The workflow must run, and its result must come back to the agent.

`workflow_dispatch` and `repository_dispatch` only start workflows whose file exists on the default branch.

## Decisions

Answer these before work starts.

1. **How the agent's workflow changes reach the branch.** Options:
   - (a) Commit them directly when `.codemanignore` allows it, with `workflows: write` on apply's token. They run with secrets before anyone reviews them.
   - (b) Stage them. Apply commits the agent's changes under `.github/workflows/` to `.codeman/workflows/` on the task branch instead, where they do not run, and lists them on the status comment and the pull request. After reading them in the diff, a maintainer comments `/codeman accept-workflows`. Apply then moves them into `.github/workflows/` with a token that has `workflows: write`. The move uses the staged files as they were when the comment was posted; if a later commit changed them, Codeman asks again.
   - (c) Do not commit them. Codeman posts them on the pull request as a patch, and a maintainer commits them by hand.

   Recommendation: (b). The workflow shows in the pull request's diff, the approval is explicit and recorded, and nothing the agent wrote runs before it. The agent can never write `.codeman/`, so only apply can stage files there.
2. **Scope.** Options: (a) A and B in this plan, A first; (b) A only, B in a later plan. Recommendation: (a), with A as its own step, so the deploy case is unblocked early.
3. **How a workflow the agent needs runs (B).** Options:
   - (a) It listens to `push` on the task branch. It starts as soon as `/codeman accept-workflows` moves it into place. Codeman waits in `codeman:awaiting-workflow` for the runs on the branch's head commit, then resumes the task.
   - (b) It goes to the default branch in a separate pull request. Merging it is the approval. Codeman then starts it with `workflow_dispatch` on the task branch.

   Recommendation: (a). It needs no second pull request, and the results belong to the commit that produced them. The cost: it runs again on every later push to the branch, unless the agent limits it with `paths` filters, as the prompt will ask. Option (b) is the one the MVP plan sketched.
4. **What the agent gets back (B).** Options:
   - (a) Each job's conclusion, the last 64 KiB of the log of each failed step, and the run's artifacts up to 50 MiB in total, copied into the agent's worktree under `.codeman/results/`;
   - (b) conclusions and logs only.

   Recommendation: (a). Build outputs and test reports are often the reason to run the workflow. Everything that comes back is untrusted input, like issue text.

## Steps

1. Workflows as deliverables (A)
   - [ ] Apply stages the agent's changes under `.github/workflows/` in `.codeman/workflows/` (decision 1), and lists them on the status comment and the pull request with instructions.
   - [ ] `/codeman accept-workflows` from a maintainer: apply moves the staged files into place with `workflows: write`, only if they did not change after the comment, and records who accepted.
   - [ ] Template and docs: the accept path's token permission, the risk explained, and `.codemanignore` still able to forbid workflow changes altogether.
   - [ ] Done when: on the test repository, a task that asks for a deploy workflow ends with that workflow in the pull request, after `/codeman accept-workflows`.
2. Workflows the agent needs (B)
   - [ ] Implementation output: status `awaiting-workflow`, with the workflow and what it should produce. Apply stages it as in step 1 and sets `codeman:awaiting-workflow`.
   - [ ] `select` resumes the task when the runs of the accepted workflow on the branch's head finish, and hands their results to the agent (decision 4).
   - [ ] Document GitHub Environments with required reviewers for workflows that need secrets.
   - [ ] Done when: on the test repository, a task that needs a macOS runner completes, with a maintainer accepting the workflow.

## Out of scope

- Running workflows without a maintainer's approval, for any repository setting.
- Workflows in repositories other than the task's.
- Self-hosted runners.
