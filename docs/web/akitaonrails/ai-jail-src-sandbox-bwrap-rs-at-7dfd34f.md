---
title: "ai-jail: src/sandbox/bwrap.rs at 7dfd34f"
url: https://github.com/akitaonrails/ai-jail/blob/7dfd34ff66b914a41b05f79b12b6b117d5ce9fe0/src/sandbox/bwrap.rs
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-repositories.md
---

# ai-jail: src/sandbox/bwrap.rs at 7dfd34f

The Linux backend of `akitaonrails/ai-jail` at commit `7dfd34f` (v2.10.0), which builds bwrap's arguments. The file has 8,416 lines and the repository is GPL-3.0-only, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`isolation_args`.** Every launch passes `--chdir <project>`, `--die-with-parent`, `--unshare-pid`, `--unshare-uts` and `--unshare-ipc`. `--unshare-net` is added unless the network is enabled; `--new-session` in lockdown or when the terminal calls for it.
- **`discover_base_with_nix_root`, the base mounts.** `/usr`, `/etc`, `/opt` and `/sys` are bound read-only; `/bin`, `/lib`, `/lib64` and `/sbin` are recreated as links into `/usr` on merged-`/usr` systems. `/dev` is a new devtmpfs, `/proc` a new procfs, and `/tmp` and `/run` new tmpfs mounts. `/etc/hosts` and the resolver's file are bound read-only on top. Paths not listed, such as `/var`, `/srv` and `/mnt`, are not in the sandbox.
- **The bwrap binary.** It is looked for in `/usr/bin/bwrap`, `/bin/bwrap`, `/usr/local/bin/bwrap`, `/run/wrappers/bin/bwrap` and `/run/current-system/sw/bin/bwrap`, or taken from `BWRAP_BIN` after the ownership check.
- **`landlock_wrapper_args`, the wrapper.** ai-jail binds its own binary read-only at `/tmp/.ai-jail-landlock`, after the `/tmp` tmpfs, and starts the command through it with `--landlock-exec`, which applies Landlock inside the sandbox before it runs the command.
