---
title: /usr/share/polkit-1/actions/org.freedesktop.login1.policy in systemd_255.4-1ubuntu8.17_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/s/systemd/systemd_255.4-1ubuntu8.17_amd64.deb
created_at: 2026-10-20T09:54:45-03:00
updated_at: 2026-10-20T09:54:45-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/polkit-1/actions/org.freedesktop.login1.policy in systemd_255.4-1ubuntu8.17_amd64.deb

The polkit actions of `systemd-logind` in `noble-updates` on 2026-10-20, from the `systemd` package, checked against the SHA-256 in `dists/noble-updates/main/binary-amd64/Packages.gz`, itself checked against the suite's `Release`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`org.freedesktop.login1.set-self-linger`.** "Allow non-logged-in user to run programs". Its defaults are `yes` for `allow_any`, `allow_inactive` and `allow_active`: any user may turn lingering on for itself over the system bus, without a session and without authentication.
- **What lingering does.** A lingering user keeps a systemd user manager running while it has no session, so the programs that manager starts run outside any jail the user was in.
