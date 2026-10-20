---
title: /usr/share/man/man1/unshare.1.gz in util-linux_2.39.3-9ubuntu6.6_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/u/util-linux/util-linux_2.39.3-9ubuntu6.6_amd64.deb
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/man/man1/unshare.1.gz in util-linux_2.39.3-9ubuntu6.6_amd64.deb

The manual of `unshare`, from Ubuntu 24.04's `util-linux` package in `noble-updates` when recorded. The package's SHA-256, `08eb17ba3b83378ed1e73d8335d0ce03b429c0bbeb07e374f536234edab02465`, matched the one in `dists/noble-updates/main/binary-amd64/Packages.gz`. The package is `Essential: yes` and `Priority: required`, and installs `/usr/bin/unshare`, `/usr/bin/setpriv` and `/usr/bin/findmnt`, each `-rwxr-xr-x root root`; `mount` comes from the `mount` package of the same source. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`-m, --mount`, `-p, --pid`, `-i, --ipc`.** New mount, PID and IPC namespaces.
- **`-f, --fork`.** Runs the program as a child. While it waits for the child, `unshare` ignores SIGINT and SIGTERM and forwards no signal: signals must go to the child.
- **`--kill-child[=signame]`.** When `unshare` ends, it sends `signame` (SIGKILL by default) to the child; with `--pid`, this kills the whole tree below it. Implies `--fork`.
- **`--mount-proc`.** Mounts a new procfs just before running the program, for a new PID namespace.
- **`--propagation private|shared|slave|unchanged`.** Sets the propagation of every mount in the new namespace; `private` by default, so mounts made inside do not reach the host.
