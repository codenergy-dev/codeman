---
title: /etc/sudoers in sudo_1.9.15p5-3ubuntu5.24.04.4_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/s/sudo/sudo_1.9.15p5-3ubuntu5.24.04.4_amd64.deb
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /etc/sudoers in sudo_1.9.15p5-3ubuntu5.24.04.4_amd64.deb

The default `/etc/sudoers` that Ubuntu 24.04's `sudo` package installs, in the version that `noble-updates` and `noble-security` served when recorded. The package's SHA-256, `deaf622cdfa623d3efca7b797e38ceae461769b2ec427e8ecd8e6c0fcb745f3c`, matched the one in `dists/noble-updates/main/binary-amd64/Packages.gz`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`Defaults env_reset`.** Commands run with a new, minimal environment.
- **`Defaults secure_path`.** `sudo` finds and runs each command with this `PATH`: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`. `/usr/local/bin` comes before `/usr/bin`.
- **`@includedir /etc/sudoers.d`.** Files in `/etc/sudoers.d` can add rules and defaults, and override `secure_path`. The rules that give the runner's user `sudo` on GitHub's runners are not in this file, nor in the build scripts of `actions/runner-images`; they were not recorded.
