---
title: "multipath-tools_0.14.3-2ubuntu1 source package"
url: http://archive.ubuntu.com/ubuntu/pool/main/m/multipath-tools/multipath-tools_0.14.3-2ubuntu1.dsc
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# multipath-tools_0.14.3-2ubuntu1 source package

The source of `multipathd` in Ubuntu 26.04's `resolute` on 2026-11-24 (`resolute-updates` has none newer): `multipath-tools_0.14.3.orig.tar.gz` and `multipath-tools_0.14.3-2ubuntu1.debian.tar.xz`, each checked against the SHA-256 in `dists/resolute/main/source/Sources.gz`, itself checked against the suite's `Release`. The code is GPL-2.0, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The sockets.** `multipathd/multipathd.socket.in` listens on `@ABSTRACT_SOCKET@` and `@PATHNAME_SOCKET@`, which `Makefile.inc` sets to the abstract `@/org/kernel/linux/storage/multipathd`, as [0.9.4](multipath-tools-0-9-4-5ubuntu8-2-source-package.md) records, and the path `/run/multipathd.socket`, which the sandbox test does not list among abstract sockets. Still `ConditionVirtualization=!container`.
- **Who may change anything.** Unchanged from [0.9.4](multipath-tools-0-9-4-5ubuntu8-2-source-package.md): `_socket_client_is_root` in `multipathd/uxlsnr.c` counts only uid 0 from `SO_PEERCRED`, and a client that is not root may only run `list` commands ("permission deny: need to be root").
- **Ubuntu's patches.** None changes `multipathd/uxlsnr.c`.
