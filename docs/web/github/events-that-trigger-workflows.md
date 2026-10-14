---
title: Events that trigger workflows
url: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
created_at: 2026-10-13T20:48:00-03:00
updated_at: 2026-10-14T17:40:56-03:00
tool: docs/web/tools/github.md
---

# Events that trigger workflows

GitHub's reference of every event is too large to keep here (about 90 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/actions/reference/workflows-and-actions/events-that-trigger-workflows`).

## `issue_comment`

- Activity types: `created`, `edited`, `deleted`; without `types`, all of them trigger the workflow.
- It runs on the last commit of the default branch, and only if the workflow file exists on the default branch.
- It occurs for comments on issues and on pull requests; `github.event.issue.pull_request` tells them apart.

## `issues`

- Activity types: `opened`, `edited`, `deleted`, `transferred`, `pinned`, `unpinned`, `closed`, `reopened`, `assigned`, `unassigned`, `labeled`, `unlabeled`, `locked`, `unlocked`, `milestoned`, `demilestoned`, `typed`, `untyped`, `field_added`, `field_removed`.
- Without `types`, every activity type triggers the workflow; `on.issues.types` limits it to some.
- It runs on the last commit of the default branch (`GITHUB_REF` is the default branch), and only if the workflow file exists on the default branch.
- It is about the issue itself; comments are the `issue_comment` event.

## `pull_request`

- It runs on the pull request's merge branch: `GITHUB_REF` is `refs/pull/<number>/merge`, and `GITHUB_SHA` the last merge commit on it (the event's table). The workflow file therefore comes from the pull request.
- "Workflows in forked repositories": with the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is triggered from a forked repository, and the `GITHUB_TOKEN` has read-only permissions in pull requests from forked repositories. Workflows don't run in forked repositories until GitHub Actions is enabled in the fork's **Actions** tab.
- "Pull request events for forked repositories": for a pull request from a fork, GitHub sends `pull_request`, `issue_comment`, `pull_request_review_comment`, `pull_request_review` and `pull_request_target` to the base repository; no pull request events occur on the fork. A first-time contributor's workflows on a public repository may need a maintainer's approval. Pull requests from forks to a private repository run workflows only when the repository's settings enable it.
- Workflows triggered by Dependabot pull requests are treated as though they come from a fork (the note in the same section).

## `pull_request_review`

- Activity types: `submitted`, `edited`, `dismissed`.
- Like `pull_request`, it runs on the merge branch `refs/pull/<number>/merge`, so the workflow file comes from the pull request (the event's table).
- The same "Workflows in forked repositories" and "Pull request events for forked repositories" rules as `pull_request`: no secrets except a read-only `GITHUB_TOKEN` for a review on a pull request from a fork.

## `pull_request_target`

- It runs on the last commit of the default branch (`GITHUB_REF` is the default branch), in the context of the base repository, rather than on the merge commit as `pull_request` does (the event's table and first paragraphs).
- That keeps the pull request's code from running with the repository's secrets, and lets a workflow label or comment on pull requests from forks. GitHub advises against it when the workflow needs to build or run code from the pull request; running untrusted code on it may lead to cache poisoning and to unintended write access or secrets ([Securely using pull_request_target](securely-using-pull-request-target.md)).

## `schedule`

- It runs on the last commit of the default branch, only on the default branch, and only if the workflow file exists there (the event's table and note).
- In a public repository, scheduled workflows are disabled after 60 days without repository activity.

## `workflow_dispatch`

- No activity types. The run uses the last commit of the branch or tag it was dispatched on (`GITHUB_REF`).
- It only triggers a run if the workflow file exists on the default branch. Once the workflow has run once, the API or GitHub CLI can dispatch it on any branch or tag.
- Inputs (section "Providing inputs"): at most 25 top-level properties, and a payload of at most 65,535 characters. They are in the `inputs` context and in `github.event.inputs`, where booleans become strings.
