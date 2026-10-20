---
title: /etc/apparmor.d/unprivileged_userns in apparmor_4.0.1really4.0.1-0ubuntu0.24.04.9_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/a/apparmor/apparmor_4.0.1really4.0.1-0ubuntu0.24.04.9_amd64.deb
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /etc/apparmor.d/unprivileged_userns in apparmor_4.0.1really4.0.1-0ubuntu0.24.04.9_amd64.deb

An AppArmor profile from Ubuntu 24.04's `apparmor` package in `noble-updates` when recorded. The package's SHA-256, `59af23f557d666039708ec176aa056d2fd85125dabd452accf6d86f5c608fb74`, matched the one in `dists/noble-updates/main/binary-amd64/Packages.gz`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The profile's comment.** `unprivileged_userns` is the profile an unconfined process moves to when it creates a user namespace without privileges.
- **Its rules.** `audit deny capability` and `audit deny change_profile`: inside that namespace, the process gets no capability, so it cannot mount. It keeps file, network, signal, D-Bus, Unix and ptrace access, and its children stay in the profile.
- **Other profiles.** Among the 96 files the package installs directly in `/etc/apparmor.d`, none is for `bwrap`.
