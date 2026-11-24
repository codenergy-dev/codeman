---
title: "/usr/share/man/man1/bwrap.1.gz in bubblewrap_0.11.1-1ubuntu0.3_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.11.1-1ubuntu0.3_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/man/man1/bwrap.1.gz in bubblewrap_0.11.1-1ubuntu0.3_amd64.deb

The manual of `bwrap` 0.11.1, as Ubuntu 26.04's current `bubblewrap` package installs it; the package was checked as [/usr/bin/bwrap](usr-bin-bwrap-in-bubblewrap-0-11-1-1ubuntu0-3-amd64-deb.md) says. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

Every option and behavior that [0.9.0's manual](usr-share-man-man1-bwrap-1-gz-in-bubblewrap-0-9-0-1ubuntu0-3-amd64-deb.md) records reads the same here: the empty tmpfs root and the user namespace needed when not setuid; the PID 1 that reaps zombies; `--ro-bind`, `--bind`, `--dev`, `--proc`; `--perms` then `--tmpfs` (mode 0755 by default); `--unshare-pid`, `--unshare-ipc`, `--unshare-net`; `--uid`, `--gid` and `--disable-userns`, which require `--unshare-user`; `--new-session`; `--die-with-parent`; `--cap-add` and `--cap-drop`, with no capability left by default; and the exit status of PID 2.
