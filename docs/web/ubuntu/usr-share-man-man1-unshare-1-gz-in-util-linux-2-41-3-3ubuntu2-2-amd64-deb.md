---
title: "/usr/share/man/man1/unshare.1.gz in util-linux_2.41.3-3ubuntu2.2_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/u/util-linux/util-linux_2.41.3-3ubuntu2.2_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/man/man1/unshare.1.gz in util-linux_2.41.3-3ubuntu2.2_amd64.deb

The manual of `unshare`, from Ubuntu 26.04's `util-linux` package in `resolute-updates` when recorded. The package's SHA-256, `11fd410b1d3797b1e9127b68302160213c15e1553745fb6982e270b1e32d1f2a`, matched the one in `dists/resolute-updates/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. The package is `Essential: yes` and `Priority: required`, and installs `/usr/bin/unshare`, `/usr/bin/setpriv` and `/usr/bin/findmnt`, each `-rwxr-xr-x`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

The same as in [2.39.3's manual](usr-share-man-man1-unshare-1-gz-in-util-linux-2-39-3-9ubuntu6-6-amd64-deb.md):

- **`-m, --mount`, `-p, --pid`, `-i, --ipc`.** New mount, PID and IPC namespaces.
- **`-f, --fork`.** Runs the program as a child; while waiting, `unshare` ignores SIGINT and SIGTERM and forwards no signal.
- **`--kill-child[=signame]`.** SIGKILL by default to the child when `unshare` ends; with `--pid`, the whole tree. Implies `--fork`.
- **`--mount-proc`.** Mounts a new procfs just before running the program.
- **`--propagation`.** `private` by default.
