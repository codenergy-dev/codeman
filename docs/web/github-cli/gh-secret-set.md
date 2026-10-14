---
title: gh secret set
url: https://cli.github.com/manual/gh_secret_set
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/github-cli.md
---

# gh secret set

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from. Checked against release v2.102.0, the latest when recorded.

## Facts

- Sets a secret of a repository (the default), an environment, an organization (`-o`, `--org`) or a user. Organization and user secrets can be limited to chosen repositories. The value is encrypted locally before it is sent (description).
- `-b`, `--body`: the value; without it, the command reads the value from standard input (Options).
- `-v`, `--visibility`: who in the organization may use an organization secret, one of `all`, `private` or `selected`; `private` by default (Options).
- `-r`, `--repos`: the repositories that may use an organization or user secret, comma-separated, such as `--repos repo1,repo2,repo3` (Options, Examples).
- `--no-repos-selected`: no repository may use the organization secret (Options).
- In the code, `--visibility selected` requires `--repos` or `--no-repos-selected`; `--repos` with another visibility is an error; and `--repos` without `--visibility` sets `selected`. Names without an owner are looked up in the organization ([`pkg/cmd/secret/set/set.go`](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/secret/set/set.go)).
