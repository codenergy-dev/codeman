---
title: gh environment
url: https://cli.github.com/manual/gh_help_environment
created_at: 2026-10-21T00:10:00-03:00
updated_at: 2026-10-21T00:10:00-03:00
tool: docs/web/tools/github-cli.md
---

# gh environment

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman relies on; each fact names the variable it comes from. Checked against release v2.102.1, the latest when recorded; the e2e runner image pins v2.102.0, which v2.102.1 changes only in its Go toolchain ([release](cli-v2-102-0.md)).

## Facts

- `GH_TOKEN`, then `GITHUB_TOKEN`: the token used when a command targets github.com or a subdomain of ghe.com. It takes precedence over stored credentials (`GH_TOKEN, GITHUB_TOKEN`).
- `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN`: the token used when a command targets a GitHub Enterprise Server host (`GH_ENTERPRISE_TOKEN, GITHUB_ENTERPRISE_TOKEN`). So with `GH_HOST` on another host, `GH_TOKEN` alone is not sent.
- `GH_HOST`: the host for commands that name none and cannot infer one from a local repository. Without stored credentials for it, `GH_TOKEN` or `GH_ENTERPRISE_TOKEN` is required, depending on the host (`GH_HOST`).
- `GH_REPO`: the repository, as `[HOST/]OWNER/REPO`, for commands that otherwise use the local one (`GH_REPO`).
- `GH_TELEMETRY`: `false` or `0` disables telemetry, and `log` prints it to standard error instead of sending it; it takes precedence over `DO_NOT_TRACK`, which disables telemetry when `true` or `1` (`GH_TELEMETRY`, `DO_NOT_TRACK`).
- `GH_NO_UPDATE_NOTIFIER`: any value disables the check for a new version, which gh otherwise makes once every 24 hours (`GH_NO_UPDATE_NOTIFIER`).
- `GH_PROMPT_DISABLED`: any value disables interactive prompts (`GH_PROMPT_DISABLED`).
- `GH_CONFIG_DIR`: where gh stores its configuration; by default `$XDG_CONFIG_HOME/gh`, else `$HOME/.config/gh` (`GH_CONFIG_DIR`).
