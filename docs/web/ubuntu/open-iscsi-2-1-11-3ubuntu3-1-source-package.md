---
title: "open-iscsi_2.1.11-3ubuntu3.1 source package"
url: http://archive.ubuntu.com/ubuntu/pool/main/o/open-iscsi/open-iscsi_2.1.11-3ubuntu3.1.dsc
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# open-iscsi_2.1.11-3ubuntu3.1 source package

The source of `iscsid` in Ubuntu 26.04's `resolute-updates` on 2026-11-24: `open-iscsi_2.1.11.orig.tar.gz` and `open-iscsi_2.1.11-3ubuntu3.1.debian.tar.xz`, each checked against the SHA-256 in `dists/resolute-updates/main/source/Sources.gz`, itself checked against the suite's `Release`. The code is GPL-2.0, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

Unchanged from [2.1.9](open-iscsi-2-1-9-3ubuntu5-5-source-package.md):

- **The socket.** `etc/systemd/iscsid.socket` listens on the abstract `@ISCSIADM_ABSTRACT_NAMESPACE` (`ISCSIADM_NAMESPACE` in `usr/mgmt_ipc.h`).
- **Who may use it.** `mgmt_ipc_handle_check_auth` in `usr/mgmt_ipc.c` reads `SO_PEERCRED` first, and refuses with `ISCSI_ERR_ACCESS` a client whose uid is not 0 (`mgmt_authorized_uid`), or, in the legacy mode, whose user is not `root` (`mgmt_peeruser`).
- **Ubuntu's patches.** None changes `usr/mgmt_ipc.c`.
