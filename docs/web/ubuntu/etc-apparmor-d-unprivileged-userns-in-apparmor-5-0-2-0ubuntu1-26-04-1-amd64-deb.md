---
title: "/etc/apparmor.d/unprivileged_userns in apparmor_5.0.2-0ubuntu1~26.04.1_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/a/apparmor/apparmor_5.0.2-0ubuntu1~26.04.1_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /etc/apparmor.d/unprivileged_userns in apparmor_5.0.2-0ubuntu1~26.04.1_amd64.deb

An AppArmor profile from Ubuntu 26.04's `apparmor` package in `resolute-updates` when recorded. The package's SHA-256, `8621170a44534ef32ab4f7e26a5cacabb2077a5a95bcb5236c0652f118032820`, matched the one in `dists/resolute-updates/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The profile's comment.** As on [Ubuntu 24.04](etc-apparmor-d-unprivileged-userns-in-apparmor-4-0-1really4-0-1-0ubuntu0-24-04-9.md): the profile an unconfined process moves to when it creates a user namespace without privileges.
- **Its rules.** The same: `audit deny capability` and `audit deny change_profile`; file, network, signal, D-Bus, Unix, mqueue, ptrace and userns allowed; children stacked on the profile (`pix /** -> &unprivileged_userns`). The ABI is now `abi/5.0`.
- **Other profiles.** The package installs 153 files directly in `/etc/apparmor.d`, against 96. One is for `bwrap`: [`bwrap-userns-restrict`](etc-apparmor-d-bwrap-userns-restrict-in-apparmor-5-0-2-0ubuntu1-26-04-1-amd64-de.md), which Ubuntu 24.04's package did not have. Others name `lxc-unshare` and `glycin.bwrap`.
