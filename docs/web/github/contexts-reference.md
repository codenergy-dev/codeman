---
title: Contexts reference
url: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
created_at: 2026-10-13T20:48:00-03:00
updated_at: 2026-10-14T15:59:02-03:00
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
| `jobs.<job_id>.steps.env`, `jobs.<job_id>.steps.run`, `jobs.<job_id>.steps.with` | `github`, `needs`, `strategy`, `matrix`, `job`, `runner`, `env`, `vars`, `secrets`, `steps`, `inputs` | `hashFiles` |

- A job's `if` is evaluated by GitHub Actions, and the job is sent to a runner only when it is true (the example before the table).
- The listed contexts are available only for the given key, and may not be used anywhere else (the paragraph before the table). The table has no row for a step's `uses`, so it takes no context: the action a step runs cannot come from a variable, while its `with`, `env` and `run` can use `vars`.
