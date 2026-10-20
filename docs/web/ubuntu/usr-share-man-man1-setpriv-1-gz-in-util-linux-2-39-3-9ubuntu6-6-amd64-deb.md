---
title: /usr/share/man/man1/setpriv.1.gz in util-linux_2.39.3-9ubuntu6.6_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/u/util-linux/util-linux_2.39.3-9ubuntu6.6_amd64.deb
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/man/man1/setpriv.1.gz in util-linux_2.39.3-9ubuntu6.6_amd64.deb

The manual of `setpriv`, from the same `util-linux` package as [unshare's](usr-share-man-man1-unshare-1-gz-in-util-linux-2-39-3-9ubuntu6-6-amd64-deb.md), checked the same way. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`--reuid`, `--regid`.** Set the real and effective user and group IDs, by number or name.
- **`--init-groups`.** Sets the supplementary groups with `initgroups(3)`; only with `--ruid` or `--reuid`. **`--clear-groups`** clears them.
- **`--no-new-privs`.** Sets `no_new_privs`: `execve(2)` grants no new privileges, so set-user-ID and set-group-ID bits and file capabilities have no effect. The bit is inherited by children.
- **`--inh-caps`, `--bounding-set`.** Set the inheritable capabilities and the bounding set, such as `-all`.
