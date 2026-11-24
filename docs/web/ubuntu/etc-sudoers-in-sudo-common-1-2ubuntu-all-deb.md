---
title: "/etc/sudoers in sudo-common_1.2ubuntu_all.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/s/sudo-common/sudo-common_1.2ubuntu_all.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /etc/sudoers in sudo-common_1.2ubuntu_all.deb

The default `/etc/sudoers` on Ubuntu 26.04. It moved from the `sudo` package to `sudo-common`, which both `sudo` and `sudo-rs` use. The package's SHA-256, `ba909e8e796115f442d0915ed3baa1b752e8809ec4d8e723d2bbd0d177750d2c`, matched the one in `dists/resolute/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`Defaults env_reset`.** Commands run with a new, minimal environment.
- **`Defaults secure_path`.** The same as on [Ubuntu 24.04](etc-sudoers-in-sudo-1-9-15p5-3ubuntu5-24-04-4-amd64-deb.md): `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`, `/usr/local/bin` before `/usr/bin`.
- **`Defaults use_pty`.** New in this file: a command run from a terminal gets a pseudo-terminal.
- **`@includedir /etc/sudoers.d`.** As on Ubuntu 24.04, files there can add rules and defaults.
