---
title: Workflow syntax for GitHub Actions
url: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
created_at: 2026-10-07T21:03:01-03:00
updated_at: 2026-10-14T15:59:08-03:00
tool: docs/web/tools/github.md
---

# Workflow syntax for GitHub Actions

GitHub's reference of the workflow syntax is too large to keep here (about 230 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/actions/reference/workflows-and-actions/workflow-syntax`).

## `jobs.<job_id>.outputs`

- A job's outputs are a map that every job depending on it reads through the `needs` context.
- Size: a job's outputs may hold at most 1 MB, and all the outputs of a workflow run at most 50 MB. GitHub approximates the size from the text's UTF-16 encoding, so a character of ASCII counts two bytes.
- Expressions in outputs are evaluated on the runner at the end of the job. An output that may contain a secret is redacted on the runner and not sent, with the warning "Skip output `{output.Key}` since it may contain secret."

## `jobs.<job_id>.steps[*].uses`

- `{owner}/{repo}@{ref}` runs an action of a public repository at a branch, tag or SHA; a commit SHA is the safest for stability and security (the section's opening list, "Example: Using a public action").
- `./path/to/dir` runs the action in that directory of the runner's workspace, relative to the default working directory (`github.workspace`, `$GITHUB_WORKSPACE`), not of the workflow's repository: something must put it there first, such as `actions/checkout` ("Example: Using an action in the same repository as the workflow", and the table before it).
- `$/path/to/action` runs an action of the workflow's own repository at the running commit, without a checkout; it always resolves to the repository of the file it appears in ("Example: Using an action in the same repository as the workflow at the running commit"). Not available on GitHub Enterprise Server.
