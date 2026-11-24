---
title: util-linux_2.39.3-9ubuntu6.6 source package
url: http://archive.ubuntu.com/ubuntu/pool/main/u/util-linux/util-linux_2.39.3-9ubuntu6.6.dsc
created_at: 2026-11-24T15:40:31-03:00
updated_at: 2026-11-24T15:40:31-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# util-linux_2.39.3-9ubuntu6.6 source package

The source of `mount` and its library, libmount, in `noble-updates` on 2026-11-24: `util-linux_2.39.3.orig.tar.xz` and `util-linux_2.39.3-9ubuntu6.6.debian.tar.xz`, each checked against the SHA-256 in `dists/noble-updates/main/source/Sources.gz`, itself checked against the suite's `Release`. The same version builds the `mount` package, `mount_2.39.3-9ubuntu6.6_amd64.deb`, checked against `dists/noble-updates/main/binary-amd64/Packages.gz`. The code is GPL-2.0 and LGPL-2.1, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **utab.** libmount keeps the options that the kernel does not store, its userspace options such as `x-gdu.hide`, in `/run/mount/utab` (`MNT_PATH_UTAB` in `libmount/src/mountP.h`; the environment variable `LIBMOUNT_UTAB` overrides it). A mount gets an entry only when it has such options (`utab_new_entry` in `libmount/src/tab_update.c`).
- **Every mount updates it after the syscall.** `mnt_context_mount` in `libmount/src/context_mount.c` prepares the update, mounts, then calls `mnt_context_update_tabs`. A remount reads the mount's entry, so a mount with userspace options has its entry rewritten.
- **The error.** When the mount succeeds and a later step fails, `mount` reports "filesystem was mounted, but any subsequent operation failed", with the step's error, and exits with 32, `MNT_EX_FAIL`, for any error but `EINVAL`, `EPERM` and `ENOMEM` (`mnt_context_get_mount_excode` in the same file, through `mnt_context_get_generic_excode` in `libmount/src/context.c`). A write to `utab` on a read-only `/run` fails with "Read-only file system".
- **`-n`, `--no-mtab`.** `sys-utils/mount.c` turns it into `mnt_context_disable_mtab`, which sets `MNT_FL_NOMTAB`. With it, `context_init_paths`, `mnt_context_prepare_update` and `mnt_context_update_tabs` in `libmount/src/context.c` neither check nor write `utab`. The manual, `mount(8)`, names only `/etc/mtab` for this option.
- **Ubuntu's patches.** Of those in `debian/patches/series`, `CVE-2026-53613.patch` opens a mount's target without following symbolic links, only for a mount by a user other than root (`mnt_context_target_fd_required`). None changes how `utab` is written.
