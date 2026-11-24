---
title: "/etc/apparmor.d/bwrap-userns-restrict in apparmor_5.0.2-0ubuntu1~26.04.1_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/a/apparmor/apparmor_5.0.2-0ubuntu1~26.04.1_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /etc/apparmor.d/bwrap-userns-restrict in apparmor_5.0.2-0ubuntu1~26.04.1_amd64.deb

An AppArmor profile from the same `apparmor` package as [unprivileged_userns](etc-apparmor-d-unprivileged-userns-in-apparmor-5-0-2-0ubuntu1-26-04-1-amd64-deb.md), checked the same way. New since Ubuntu 24.04. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Its purpose, by its comment.** It lets `bwrap` work where user namespaces are restricted: `bwrap` may create user namespaces and use capabilities inside them, and its children get none.
- **Profile `bwrap`, attached to `/usr/bin/bwrap`.** Allows `capability`, `userns`, `mount`, `umount`, `pivot_root`, and file, network, Unix, ptrace, signal, mqueue, io_uring and D-Bus access. What it runs is stacked as `&bwrap//&unpriv_bwrap` (`pix /**`), because of `bwrap`'s `no_new_privs`.
- **Profile `unpriv_bwrap`.** The same access, but `audit deny capability`, and its children stay stacked on it.

So on Ubuntu 26.04, a user without privileges, such as the agent, may run `/usr/bin/bwrap` to build its own namespaces while `kernel.apparmor_restrict_unprivileged_userns` holds, which Ubuntu 24.04's packages did not allow ([issue 10443](../github/ubuntu-24-04-error-during-unshare-operation-not-permitted.md)). Whether the runner loads this profile is for CI to show.
