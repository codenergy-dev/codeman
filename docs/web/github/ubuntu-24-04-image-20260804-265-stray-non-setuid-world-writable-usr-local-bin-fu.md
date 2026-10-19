---
title: Ubuntu 24.04 image 20260804.265: stray non-setuid, world-writable /usr/local/bin/fusermount3 shadows the setuid helper, breaking unprivileged FUSE mounts
url: https://github.com/actions/runner-images/issues/14516
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/github-repositories.md
---

# Ubuntu 24.04 image 20260804.265: stray non-setuid, world-writable /usr/local/bin/fusermount3 shadows the setuid helper, breaking unprivileged FUSE mounts

Issue 14516 of `actions/runner-images`, opened on 2026-08-07 and closed as completed on 2026-08-10. An issue's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Description.** The report first blamed the kernel for a failing FUSE mount.
- **First comment, by the reporter (2026-08-07).** The cause was a stray `fusermount3` in `/usr/local/bin` that no package owns. `stat` printed it as `-rwxrwxrwx root:root`, against `-rwsr-xr-x root:root` for `/usr/bin/fusermount3`. Since `/usr/local/bin` comes before `/usr/bin` on the `PATH`, `type -a` found the stray copy first, and every tool that ran `fusermount3` by name ran it.
- **Later comments, by the maintainers.** They rolled the image back and planned a fixed release.

So, on a live `ubuntu-latest` runner of August 2026, a file in `/usr/local/bin` was writable by every user, and it shadowed the program of the same name in `/usr/bin`. The issue does not show the mode of the directory itself.
