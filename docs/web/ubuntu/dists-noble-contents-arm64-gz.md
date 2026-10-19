---
title: dists/noble/Contents-arm64.gz
url: http://ports.ubuntu.com/ubuntu-ports/dists/noble/Contents-arm64.gz
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# dists/noble/Contents-arm64.gz

The index of the files that each package of Ubuntu 24.04 (noble) installs on arm64, as of its release. Its SHA-256, `c0c2eef334518bb29513157aed43bf0a064d69f4482f515e1d7268403c066620`, matched the one in `dists/noble/Release`.

This page keeps only the programs that Codeman runs in the `agent` job, outside the sandbox. Each line of the index names one path and the packages (section/name) that install it.

| Path | Package |
| --- | --- |
| `/usr/bin/bash` | shells/bash |
| `/usr/bin/chmod` | utils/coreutils |
| `/usr/bin/chown` | utils/coreutils |
| `/usr/bin/cp` | utils/coreutils |
| `/usr/bin/crontab` | admin/cron,universe/utils/systemd-cron,universe/admin/cronie,universe/admin/bcron |
| `/usr/bin/env` | utils/coreutils |
| `/usr/bin/find` | utils/findutils |
| `/usr/bin/git` | vcs/git |
| `/usr/bin/id` | utils/coreutils |
| `/usr/bin/install` | utils/coreutils |
| `/usr/bin/loginctl` | admin/systemd |
| `/usr/bin/mkdir` | utils/coreutils |
| `/usr/bin/pgrep` | admin/procps |
| `/usr/bin/pkill` | admin/procps |
| `/usr/bin/realpath` | utils/coreutils |
| `/usr/bin/rm` | utils/coreutils |
| `/usr/bin/sh` | shells/dash |
| `/usr/bin/sleep` | utils/coreutils |
| `/usr/bin/sudo` | admin/sudo,universe/admin/sudo-ldap |
| `/usr/bin/tar` | utils/tar |
| `/usr/bin/tee` | utils/coreutils |
| `/usr/bin/test` | utils/coreutils |
| `/usr/bin/unzip` | utils/unzip |
| `/usr/sbin/useradd` | admin/passwd |
| `/usr/sbin/usermod` | admin/passwd |

The index lists each of these programs under `usr/` only, none under `bin/` or `sbin/`.
