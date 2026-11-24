---
title: "dists/resolute/Contents-amd64.gz"
url: http://archive.ubuntu.com/ubuntu/dists/resolute/Contents-amd64.gz
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# dists/resolute/Contents-amd64.gz

The index of the files that each package of Ubuntu 26.04 (resolute) installs on x64, as of its release. Its SHA-256, `c8403f683c61f7a39219a32de5ba8363ac78183e8629f268ba704e064a394ca0`, matched the one in `dists/resolute/Release`, dated 2026-04-23.

This page keeps only the programs that Codeman runs in the `agent` job, outside the sandbox, and those the sandbox runs, as [Ubuntu 24.04's index](dists-noble-contents-amd64-gz.md) does. Each line of the index names one path and the packages (section/name) that install it.

| Path | Package |
| --- | --- |
| `/usr/bin/bash` | shells/bash |
| `/usr/bin/bwrap` | admin/bubblewrap |
| `/usr/bin/chmod`, `chown`, `cp`, `env`, `id`, `install`, `mkdir`, `realpath`, `rm`, `sleep`, `tee`, `test` | utils/coreutils-from-gnu, utils/coreutils-from-uutils, universe/utils/coreutils-from-busybox, universe/utils/coreutils-from-toybox |
| `/usr/bin/crontab` | admin/cron, universe/admin/bcron, universe/admin/cronie, universe/utils/systemd-cron |
| `/usr/bin/find` | utils/findutils |
| `/usr/bin/findmnt`, `setpriv`, `unshare` | utils/util-linux |
| `/usr/bin/git` | vcs/git |
| `/usr/bin/loginctl` | admin/systemd |
| `/usr/bin/pgrep`, `pkill` | admin/procps |
| `/usr/bin/sh` | shells/dash |
| `/usr/bin/ss` | net/iproute2 |
| `/usr/bin/sudo-rs` | utils/sudo-rs |
| `/usr/bin/tar` | utils/tar |
| `/usr/bin/unzip` | utils/unzip |
| `/usr/sbin/useradd`, `usermod` | admin/passwd |

Two differences from Ubuntu 24.04:

- **No package installs `/usr/bin/sudo`.** It is an alternative that `sudo` and `sudo-rs` each register ([sudo-rs](usr-lib-cargo-bin-sudo-in-sudo-rs-0-2-13-0ubuntu1-2-amd64-deb.md)).
- **coreutils comes from one of four packages.** The `coreutils` package (`9.5-1ubuntu2+0.0.0~ubuntu25`) pre-depends on `coreutils-from-uutils | coreutils-from-gnu`, so the Rust uutils are the default, by `dists/resolute/main/binary-amd64/Packages.gz`.

The index lists each of these programs under `usr/` only, none under `bin/` or `sbin/`. arm64 is out of the review's scope.
