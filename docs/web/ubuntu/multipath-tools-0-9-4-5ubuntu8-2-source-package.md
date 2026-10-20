---
title: multipath-tools_0.9.4-5ubuntu8.2 source package
url: http://archive.ubuntu.com/ubuntu/pool/main/m/multipath-tools/multipath-tools_0.9.4-5ubuntu8.2.dsc
created_at: 2026-10-20T02:21:04-03:00
updated_at: 2026-10-20T02:21:04-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# multipath-tools_0.9.4-5ubuntu8.2 source package

The source of `multipathd` in `noble-updates` on 2026-10-20: `multipath-tools_0.9.4.orig.tar.gz` and `multipath-tools_0.9.4-5ubuntu8.2.debian.tar.xz`, each checked against the SHA-256 in `dists/noble-updates/main/source/Sources.gz`, itself checked against the suite's `Release`. The code is GPL-2.0, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The socket.** `multipathd/multipathd.socket` makes systemd listen on the abstract Unix socket `@/org/kernel/linux/storage/multipathd`, and hand it to `multipathd`. It does not start in a container (`ConditionVirtualization=!container`).
- **Who may change anything.** In `multipathd/uxlsnr.c`, `_socket_client_is_root` reads the client's credentials with `SO_PEERCRED`, from the kernel, and counts only uid 0 as root. In the `CLT_PARSE` state, a client that is not root may only run commands whose verb is `list` (`VRB_LIST`, which `show` is an alias of); any other gets "permission deny: need to be root".
- **Ubuntu's patches.** None of the patches in `debian/patches/series` changes `multipathd/uxlsnr.c`.
