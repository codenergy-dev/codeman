---
title: "/usr/bin/bwrap in bubblewrap_0.11.1-1ubuntu0.3_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.11.1-1ubuntu0.3_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/bin/bwrap in bubblewrap_0.11.1-1ubuntu0.3_amd64.deb

The `bubblewrap` package that Ubuntu 26.04's `resolute-updates` served when recorded; `resolute` itself has `0.11.1-1`. The package's SHA-256, `d3a6c1b6b0e0474eaed6dbd055c0d601fd875af153976a0dc4aae75f4ea10868`, matched the one in `dists/resolute-updates/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`Depends`.** `libc6`, `libcap2`, `libselinux1`, as on Ubuntu 24.04. **`Installed-Size`.** 133 KB.
- **The data archive.** `/usr/bin/bwrap`, 80,424 bytes, `-rwxr-xr-x`: not setuid.
- **No sysctl file.** The package no longer installs `/usr/lib/sysctl.d/50-bubblewrap.conf` ([changelog](usr-share-doc-bubblewrap-changelog-debian-gz-in-bubblewrap-0-11-1-1ubuntu0-3-amd.md), 0.11.1-1).
- **No AppArmor profile in the package.** `apparmor` ships one for it: [bwrap-userns-restrict](etc-apparmor-d-bwrap-userns-restrict-in-apparmor-5-0-2-0ubuntu1-26-04-1-amd64-de.md).
