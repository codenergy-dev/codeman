---
title: "/usr/share/doc/bubblewrap/changelog.Debian.gz in bubblewrap_0.11.1-1ubuntu0.3_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.11.1-1ubuntu0.3_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/doc/bubblewrap/changelog.Debian.gz in bubblewrap_0.11.1-1ubuntu0.3_amd64.deb

The Debian changelog in Ubuntu 26.04's current `bubblewrap` package; the package was checked as [/usr/bin/bwrap](usr-bin-bwrap-in-bubblewrap-0-11-1-1ubuntu0-3-amd64-deb.md) says. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`0.11.1-1`, unstable.** A new upstream release; stops overriding the `kernel.unprivileged_userns_clone` sysctl, a default for years.
- **`0.11.1-1ubuntu0.1`, resolute-security, 2026-04-28.** CVE-2026-41163: ptrace disallowed while privileged code runs.
- **`0.11.1-1ubuntu0.2`, resolute-security, 2026-09-14.** The fix for [CVE-2026-87766](../containers/cve-2026-87766-sandbox-escape-symlink-traversal-via-oldroot-allows-writing-files.md).
- **`0.11.1-1ubuntu0.3`, resolute-security, 2026-09-17.** A security regression with Flatpak (LP: #2167621): the CVE-2026-87766 patches are dropped, as on Ubuntu 24.04.

So, when recorded, Ubuntu 26.04's `bwrap` is 0.11.1 without the fix for CVE-2026-87766.
