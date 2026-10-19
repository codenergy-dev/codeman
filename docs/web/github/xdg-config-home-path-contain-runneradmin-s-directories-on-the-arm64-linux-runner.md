---
title: `$XDG_CONFIG_HOME`, `$PATH` contain runneradmin's directories on the arm64 Linux runner
url: https://github.com/actions/runner-images/issues/11409
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/github-repositories.md
---

# `$XDG_CONFIG_HOME`, `$PATH` contain runneradmin's directories on the arm64 Linux runner

Issue 11409 of `actions/runner-images`, opened on 2025-01-17 and closed as completed the same day. An issue's text has no license, so this page holds, in Codeman's words, only what Codeman relies on. It reports the `ubuntu-24.04-arm` image of January 2025.

## What Codeman relies on

- **Description.** The reporter printed the job's environment after `actions/setup-python`. Its `PATH` started with `/opt/hostedtoolcache/Python/3.10.16/arm64/bin` and `/opt/hostedtoolcache/Python/3.10.16/arm64`, before the image's own entries.
- So a setup action puts its directories in the tool cache, `/opt/hostedtoolcache`, first on the `PATH` of the job's later steps.
