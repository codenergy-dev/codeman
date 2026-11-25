---
title: "coreutils-from_0.0.0~ubuntu25 source package"
url: http://archive.ubuntu.com/ubuntu/pool/main/c/coreutils-from/coreutils-from_0.0.0~ubuntu25.dsc
created_at: 2026-11-25T13:00:38-03:00
updated_at: 2026-11-25T13:00:38-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# coreutils-from_0.0.0~ubuntu25 source package

The source of Ubuntu 26.04's `coreutils` meta package and of `coreutils-from-uutils`, which picks, program by program, between the Rust uutils and GNU's coreutils. `coreutils-from_0.0.0~ubuntu25.tar.xz` (SHA-256 `0d056a4f44d84f4cbdcab60f5c62751264aaa0bbea7b7f962e906deec8752f27`) and its `.dsc` matched `dists/resolute/main/source/Sources.gz`, itself checked against the suite's `Release`; `resolute-updates` has no newer version on 2026-11-25. The packaging is GPL-3, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Who provides coreutils.** `coreutils`, essential, pre-depends on `coreutils-from-uutils | coreutils-from-gnu` (`debian/control`), so a system gets `coreutils-from-uutils` unless it chose GNU's. `coreutils-from-uutils` pre-depends on `rust-coreutils` and on `gnu-coreutils`: both are installed, GNU's programs under a `gnu` prefix, such as `/usr/bin/gnucp`.
- **Which program is whose.** `debian/coreutils-from-uutils.links` links each `/usr/bin` program to `/usr/lib/cargo/bin/coreutils/<name>`, from `rust-coreutils`, except five, which it links to GNU's: `cp` to `gnucp`, `mv` to `gnumv`, `rm` to `gnurm`, `df` to `gnudf` and `true` to `gnutrue`.
- **Of the programs Codeman runs,** `chmod`, `chown`, `dd`, `env`, `id`, `install`, `mkdir`, `realpath`, `sleep`, `tee` and `test` are uutils'; `cp` and `rm` are GNU's.
- **Why, by `debian/changelog`:**
  - 0.0.0~ubuntu24 (2025-09-26) sent `cp`, `mv` and `rm` back to GNU: they walk and change trees, and had been "a bit problematic".
  - 0.0.0~ubuntu23 sent `true` back to GNU, as images link scripts to `/bin/true` to disable them, and uutils dispatches on the link's name.
  - 0.0.0~ubuntu15 reverted `df` to GNU (LP: #2116290).
  - 0.0.0~ubuntu25 (2026-03-30), the version in Ubuntu 26.04, linked `chown` and `chmod` to uutils again (LP: #2146312).
