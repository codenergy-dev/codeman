---
title: open-iscsi_2.1.9-3ubuntu5.5 source package
url: http://archive.ubuntu.com/ubuntu/pool/main/o/open-iscsi/open-iscsi_2.1.9-3ubuntu5.5.dsc
created_at: 2026-10-20T02:21:04-03:00
updated_at: 2026-10-20T02:21:04-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# open-iscsi_2.1.9-3ubuntu5.5 source package

The source of `iscsid` in `noble-updates` on 2026-10-20: `open-iscsi_2.1.9.orig.tar.gz` and `open-iscsi_2.1.9-3ubuntu5.5.debian.tar.xz`, each checked against the SHA-256 in `dists/noble-updates/main/source/Sources.gz`, itself checked against the suite's `Release`. The code is GPL-2.0, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The socket.** `etc/systemd/iscsid.socket` makes systemd listen on the abstract Unix socket `@ISCSIADM_ABSTRACT_NAMESPACE` (`ISCSIADM_NAMESPACE` in `usr/mgmt_ipc.h`), the management socket `iscsiadm` talks to. A connection starts `iscsid`, as its unit defines it, if it is not running.
- **Who may use it.** In `usr/mgmt_ipc.c`, `mgmt_ipc_handle_check_auth` reads the client's credentials with `SO_PEERCRED` before reading any request. It refuses with `ISCSI_ERR_ACCESS` a client whose uid is not 0 (`mgmt_authorized_uid`), or, in the legacy mode, whose user is not `root` (`mgmt_peeruser`).
- **Ubuntu's patches.** None of the patches in `debian/patches/series` changes `usr/mgmt_ipc.c`.
