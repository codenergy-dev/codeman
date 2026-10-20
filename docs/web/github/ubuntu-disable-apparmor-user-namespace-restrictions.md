---
title: "[Ubuntu] Disable apparmor user namespace restrictions"
url: https://github.com/actions/runner-images/pull/11489
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-repositories.md
---

# [Ubuntu] Disable apparmor user namespace restrictions

Pull request 11489 of `actions/runner-images`, opened on 2025-01-27 and closed without being merged on 2025-01-28. An issue's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Change.** It would have added `kernel.apparmor_restrict_unprivileged_userns=0` to `/etc/sysctl.conf` in `configure-environment.sh`, with a test that reads `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` as `0`. It fixes [issue 10443](ubuntu-24-04-error-during-unshare-operation-not-permitted.md).
- **Closing comment, by a maintainer.** Closed because a workaround had been given in the issue. Later comments asked for it to be reopened; when recorded, it was still closed and unmerged (`merged: false` from `/pulls/11489`).
