---
title: gh run list
url: https://cli.github.com/manual/gh_run_list
created_at: 2026-10-17T13:13:06-03:00
updated_at: 2026-10-17T13:13:06-03:00
tool: docs/web/tools/github-cli.md
---

# gh run list

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from. Checked against release v2.102.0, the latest when recorded.

## Facts

- Lists a repository's recent workflow runs, 20 by default (`-L`, `--limit`) (description, Options).
- `-w`, `--workflow` filters by workflow; given a workflow's name, it does not fetch disabled workflows unless `-a` is passed too (description, Options).
- `-s`, `--status` filters by one status: `queued`, `completed`, `in_progress`, `requested`, `waiting`, `pending`, `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `startup_failure`, `success` or `timed_out` (Options).
- `-R`, `--repo` selects another repository, as `[HOST/]OWNER/REPO` (Options inherited from parent commands).
- `--json` prints the chosen fields; a run's include `status`, `conclusion`, `event`, `workflowName`, `createdAt` and `url` (Options, JSON Fields).
