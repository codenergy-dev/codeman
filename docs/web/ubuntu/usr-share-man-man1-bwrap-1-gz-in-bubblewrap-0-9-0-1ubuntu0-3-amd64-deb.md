---
title: /usr/share/man/man1/bwrap.1.gz in bubblewrap_0.9.0-1ubuntu0.3_amd64.deb
url: http://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.3_amd64.deb
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/share/man/man1/bwrap.1.gz in bubblewrap_0.9.0-1ubuntu0.3_amd64.deb

The manual of `bwrap` 0.9.0, as Ubuntu 24.04's current `bubblewrap` package installs it; the package was checked as [/usr/bin/bwrap](usr-bin-bwrap-in-bubblewrap-0-9-0-1ubuntu0-3-amd64-deb.md) says. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **DESCRIPTION.** bwrap builds a new mount namespace whose root is an empty tmpfs, then mounts what its options say. A user namespace is required when bwrap is not setuid root. With a PID namespace, bwrap runs a small PID 1 that reaps zombies and exits when no process is left.
- **`--ro-bind SRC DEST`, `--bind SRC DEST`.** Bind the host's `SRC` on `DEST`, read-only or read-write.
- **`--dev DEST`, `--proc DEST`.** A new devtmpfs, a new procfs.
- **`--perms OCTAL` then `--tmpfs DEST`.** A new tmpfs with that mode; without `--perms`, mode 0755.
- **`--unshare-pid`, `--unshare-ipc`, `--unshare-net`.** New PID, IPC and network namespaces; without `--unshare-net`, the sandbox shares the host's network.
- **`--uid`, `--gid`.** Require `--unshare-user`. **`--disable-userns`.** Requires `--unshare-user`, and does not work in the setuid build.
- **`--new-session`.** Calls `setsid()`, so the sandbox cannot inject input into the terminal (CVE-2017-5226).
- **`--die-with-parent`.** Kills every sandbox process with SIGKILL when bwrap or its parent dies (`PR_SET_PDEATHSIG`).
- **`--cap-add CAP`, `--cap-drop CAP`.** Apply when bwrap runs as a privileged user; by default no capability is left in the sandboxed process.
- **EXIT STATUS.** bwrap returns the exit status of the command (PID 2 in the sandbox).
