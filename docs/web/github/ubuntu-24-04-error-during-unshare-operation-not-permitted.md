---
title: "ubuntu-24.04 Error during unshare(...): Operation not permitted"
url: https://github.com/actions/runner-images/issues/10443
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-repositories.md
---

# ubuntu-24.04 Error during unshare(...): Operation not permitted

Issue 10443 of `actions/runner-images`, opened on 2024-08-15 and closed as completed on 2024-08-20. An issue's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Description.** On the standard `ubuntu-24.04` runner, `skopeo` failed with "Error during unshare(...): Operation not permitted"; the same workflow worked on 22.04.
- **A maintainer's comment (2024-08-19).** The cause is the restriction of unprivileged user namespaces in Ubuntu 24.04.
- **A later comment (2025-01-27).** The workaround for a job is `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; it links [pull request 11489](ubuntu-disable-apparmor-user-namespace-restrictions.md), which would set it in the image.

So, unless the image changed since, a user without privileges, such as `codeman-agent`, cannot get a working user namespace on `ubuntu-24.04` unless a job changes the setting with `sudo`. The pull request was not merged, and at commit `82d1b86` no build script of the Ubuntu images mentions AppArmor or user namespaces (a search of `images/ubuntu`). This was not checked on a live runner.
