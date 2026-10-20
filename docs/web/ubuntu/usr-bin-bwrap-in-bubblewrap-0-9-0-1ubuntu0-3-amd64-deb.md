---
title: /usr/bin/bwrap in bubblewrap_0.9.0-1ubuntu0.3_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.3_amd64.deb
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/bin/bwrap in bubblewrap_0.9.0-1ubuntu0.3_amd64.deb

The `bubblewrap` package that Ubuntu 24.04's `noble-updates` and `noble-security` served when recorded; `noble` itself has `0.9.0-1build1`. The package's SHA-256, `2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094`, matched the one in `dists/noble-updates/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`Depends`.** `libc6`, `libcap2`, `libselinux1`. **`Installed-Size`.** 130 KB.
- **The data archive.** `/usr/bin/bwrap` is `-rwxr-xr-x root root`, 72,160 bytes: not setuid. So it runs with the caller's privileges; a caller without them needs a user namespace.
- **`/usr/lib/sysctl.d/50-bubblewrap.conf`.** Sets `kernel.unprivileged_userns_clone=1`, a setting of older Debian kernels. It does not change AppArmor's `kernel.apparmor_restrict_unprivileged_userns`.
- **No AppArmor profile.** The package installs none.
- **`/usr/share/doc/bubblewrap/copyright`.** The program is `LGPL-2+`; some build files are `GPL-2+ with Autoconf exception`.
- **The [changelog](usr-share-doc-bubblewrap-changelog-debian-gz-in-bubblewrap-0-9-0-1ubuntu0-3-amd6.md)** says this version removed the fix for CVE-2026-87766.
