---
title: PATH is different on ubuntu-24.04-arm compared to ubuntu-24.04
url: https://github.com/actions/runner-images/issues/11414
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/github-repositories.md
---

# PATH is different on ubuntu-24.04-arm compared to ubuntu-24.04

Issue 11414 of `actions/runner-images`, opened on 2025-01-17 and closed as completed on 2025-01-20. An issue's text has no license, so this page holds, in Codeman's words, only what Codeman relies on. It reports the images of January 2025, not every version since.

## Description

`echo $PATH` in a job, as the user `runner`, printed this `PATH`.

On `ubuntu-24.04`, x64:

```text
/snap/bin:/home/runner/.local/bin:/opt/pipx_bin:/home/runner/.cargo/bin:/home/runner/.config/composer/vendor/bin:/usr/local/.ghcup/bin:/home/runner/.dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin
```

On `ubuntu-24.04-arm`, arm64, the same without `/usr/local/.ghcup/bin`, and with `/home/runneradmin/` in place of `/home/runner/`:

```text
/snap/bin:/home/runneradmin/.local/bin:/opt/pipx_bin:/home/runneradmin/.cargo/bin:/home/runneradmin/.config/composer/vendor/bin:/home/runneradmin/.dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin
```

## What Codeman relies on

On both architectures, `/opt/pipx_bin` and `/usr/local/bin` come before `/usr/bin` in the job's `PATH`, with no setup action.
