---
title: /usr/share/doc/bubblewrap/changelog.Debian.gz in bubblewrap_0.9.0-1ubuntu0.3_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.3_amd64.deb
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/doc/bubblewrap/changelog.Debian.gz in bubblewrap_0.9.0-1ubuntu0.3_amd64.deb

The Debian changelog in Ubuntu 24.04's current `bubblewrap` package; the package was checked as [/usr/bin/bwrap](usr-bin-bwrap-in-bubblewrap-0-9-0-1ubuntu0-3-amd64-deb.md) says. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`0.9.0-1ubuntu0.2`, noble-security, 2026-09-14.** A security update for [CVE-2026-87766](../containers/cve-2026-87766-sandbox-escape-symlink-traversal-via-oldroot-allows-writing-files.md): two patches that create and resolve destinations without following symbolic links.
- **`0.9.0-1ubuntu0.3`, noble-security, 2026-09-17.** A security regression, an incompatibility with Flatpak (LP: #2167621): the CVE-2026-87766 patches are dropped.

So, when recorded, Ubuntu 24.04's `bwrap` is 0.9.0 without the fix for CVE-2026-87766.
