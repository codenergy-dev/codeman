---
title: gh variable set
url: https://cli.github.com/manual/gh_variable_set
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/github-cli.md
---

# gh variable set

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from. Checked against release v2.102.0, the latest when recorded.

## Facts

- Sets a variable of a repository (the default), an environment or an organization (`-o`, `--org`). Organization variables can be limited to chosen repositories (description).
- `-b`, `--body`: the value; without it, the command reads the value from standard input (Options).
- `-v`, `--visibility`: who in the organization may use an organization variable, one of `all`, `private` or `selected`; `private` by default (Options).
- `-r`, `--repos`: the repositories that may use an organization variable, comma-separated (Options, Examples).
- In the code, `--visibility selected` requires `--repos`; `--repos` with another visibility is an error; and `--repos` without `--visibility` sets `selected`. Names without an owner are looked up in the organization ([`pkg/cmd/variable/set/set.go`](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/variable/set/set.go)).
