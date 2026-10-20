---
title: gh workflow run
url: https://cli.github.com/manual/gh_workflow_run
created_at: 2026-10-20T15:18:00-03:00
updated_at: 2026-10-20T15:18:00-03:00
tool: docs/web/tools/github-cli.md
---

# gh workflow run

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman relies on; each fact names the section of the page it comes from. Checked against release v2.102.0, the latest when recorded. What gh sends on the wire is in [run.go](cli-pkg-cmd-workflow-run-run-go-at-fc4b137.md) and [shared.go](cli-pkg-cmd-workflow-shared-shared-go-at-fc4b137.md).

## Facts

- Creates a `workflow_dispatch` event for a workflow, named by its ID, its file name or its name; the workflow file must have an `on.workflow_dispatch` trigger (usage, description).
- Inputs come from `-f`/`--raw-field` or `-F`/`--field` as `key=value`, as JSON on standard input with `--json`, or interactively (description, Options).
- `-r`, `--ref` names the branch or tag whose version of the workflow file runs; without it, the workflow runs at the repository's default branch (Options, Examples).
- `-R`, `--repo` selects another repository as `[HOST/]OWNER/REPO` (Options inherited from parent commands).
- It prints the created run's URL when one is available (description).
