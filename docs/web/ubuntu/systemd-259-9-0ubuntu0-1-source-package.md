---
title: "systemd_259.9-0ubuntu0.1 source package"
url: http://archive.ubuntu.com/ubuntu/pool/main/s/systemd/systemd_259.9-0ubuntu0.1.dsc
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# systemd_259.9-0ubuntu0.1 source package

The source of `systemd-udevd` in Ubuntu 26.04's `resolute-updates` on 2026-11-24, the version the runner image's README names: `systemd_259.9.orig.tar.gz` and `systemd_259.9-0ubuntu0.1.debian.tar.xz`, each checked against the SHA-256 in `dists/resolute-updates/main/source/Sources.gz`, itself checked against the suite's `Release`. The code is LGPL-2.1, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The socket's name.** `socket_autobind` in `src/basic/socket-util.c` binds a socket to the abstract name `@` followed by a random 64-bit number in decimal (`"@%" PRIu64` of `random_u64()`), modeled on the kernel's autobind. A new name on every start.
- **Who binds one.** `notify_socket_prepare_full` in `src/shared/notify-recv.c` creates an `AF_UNIX` datagram socket, binds it with `socket_autobind`, and turns on `SO_PASSCRED` (and `SO_PASSPIDFD` where the kernel has it). `systemd-udevd` calls it in `manager_start_worker_notify` (`src/udev/udev-manager.c`) for its workers' notifications. `systemd-homed`, `systemd-importd`, `systemd-sysupdated` and `systemd-notify` call it or `socket_autobind` too.
- **Who it listens to.** `on_worker_notify` in `src/udev/udev-manager.c` takes the sender from the credentials the kernel attached (`notify_recv_strv`), looks it up among its workers, and ignores a datagram from any other process ("Received notify datagram of unknown process").
- **Ubuntu's patches.** Of the 19 lines of `debian/patches/series`, one patch touches `src/basic/socket-util.c` (`lp2145027`, in `vsock_get_local_cid`); none changes `socket_autobind`, `notify-recv.c` or `udev-manager.c`.

A process without privileges cannot put another process's ID in its credentials, so it cannot pass for a worker.
