---
title: Events that trigger workflows
url: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
created_at: 2026-10-13T20:48:00-03:00
updated_at: 2026-10-13T20:48:00-03:00
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

## `workflow_dispatch`

- No activity types. The run uses the last commit of the branch or tag it was dispatched on (`GITHUB_REF`).
- It only triggers a run if the workflow file exists on the default branch. Once the workflow has run once, the API or GitHub CLI can dispatch it on any branch or tag.
- Inputs (section "Providing inputs"): at most 25 top-level properties, and a payload of at most 65,535 characters. They are in the `inputs` context and in `github.event.inputs`, where booleans become strings.
