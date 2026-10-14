---
title: gh secret list
url: https://cli.github.com/manual/gh_secret_list
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/github-cli.md
---

# gh secret list

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from. Checked against release v2.102.0, the latest when recorded.

## Facts

- Lists the secrets of a repository (the default), an environment, an organization (`-o`, `--org`) or a user (description, Options).
- `--json` prints the chosen fields; a secret's are `name`, `numSelectedRepos`, `selectedReposURL`, `updatedAt` and `visibility` (Options, JSON Fields).
