---
title: Contexts reference
url: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
created_at: 2026-10-13T20:48:00-03:00
updated_at: 2026-10-13T20:48:00-03:00
tool: docs/web/tools/github.md
---

# Contexts reference

GitHub's reference of the contexts is too large to keep here (about 110 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/actions/reference/workflows-and-actions/contexts`).

## Context availability

Each workflow key may use only some contexts:

| Workflow key | Contexts | Special functions |
| --- | --- | --- |
| `concurrency` (the workflow's) | `github`, `inputs`, `vars` | None |
| `jobs.<job_id>.concurrency` | `github`, `needs`, `strategy`, `matrix`, `inputs`, `vars` | None |
| `jobs.<job_id>.if` | `github`, `needs`, `vars`, `inputs` | `always`, `cancelled`, `success`, `failure` |

- A job's `if` is evaluated by GitHub Actions, and the job is sent to a runner only when it is true (the example before the table).
