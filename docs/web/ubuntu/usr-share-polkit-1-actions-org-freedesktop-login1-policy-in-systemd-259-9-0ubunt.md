---
title: "/usr/share/polkit-1/actions/org.freedesktop.login1.policy in systemd_259.9-0ubuntu0.1_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/s/systemd/systemd_259.9-0ubuntu0.1_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/polkit-1/actions/org.freedesktop.login1.policy in systemd_259.9-0ubuntu0.1_amd64.deb

The polkit actions of `systemd-logind` in Ubuntu 26.04's `resolute-updates` on 2026-11-24, from the `systemd` package, the version the runner image's README names. The package's SHA-256, `f4189a9737929afa8c7e9fcb3cc86ec4d93982477d272c55e67fb4e34a0a13b8`, matched the one in `dists/resolute-updates/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`org.freedesktop.login1.set-self-linger`.** Unchanged from [systemd 255](usr-share-polkit-1-actions-org-freedesktop-login1-policy-in-systemd-255-4-1ubunt.md): `yes` for `allow_any`, `allow_inactive` and `allow_active`, so any user may turn lingering on for itself, without a session and without authentication.
