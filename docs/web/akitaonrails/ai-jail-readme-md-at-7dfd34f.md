---
title: "ai-jail: README.md at 7dfd34f"
url: https://github.com/akitaonrails/ai-jail/blob/7dfd34ff66b914a41b05f79b12b6b117d5ce9fe0/README.md
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-repositories.md
---

# ai-jail: README.md at 7dfd34f

The README of `akitaonrails/ai-jail` at commit `7dfd34f` (v2.10.0). The repository is GPL-3.0-only and the file is about 47 KB, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **"What ai-jail is (and isn't)".** It runs AI coding agents in an OS sandbox: bubblewrap with Landlock, seccomp and resource limits on Linux, `sandbox-exec` on macOS. It says it is not a security boundary against hostile code or a motivated attacker: it guards against a trusted agent's mistakes, and points to a disposable VM for hostile workloads.
- **"Install".** Homebrew, the AUR, `cargo install --locked ai-jail`, Nix, and GitHub Releases with checksums: `ai-jail-linux-x86_64.tar.gz` and `ai-jail-macos-aarch64.tar.gz`. No Linux arm64 archive is named. Linux needs `bwrap` from the distribution (`apt install bubblewrap`). `BWRAP_BIN` is accepted only when it resolves to a root-owned executable that no group or other user can write.
- **"On by default".** A private home on a fresh tmpfs; the harness's own credential directory mounted read-write (`--agent-state`); dependency caches and filtered egress to package registries (`--toolchains`); mise activation; the project directory read-write; a sandbox-local `/tmp`.
- **"Off by default".** The network, among others. `--network` gives unrestricted network; `--allow-host HOST` gives filtered egress through a built-in CONNECT proxy, TCP only, with no DNS inside the sandbox on Linux, and private addresses blocked.
- **"Host loopback services: `--forward-port PORT`".** Without `--network`, the sandbox has its own loopback; `--forward-port` relays one host port on `127.0.0.1` into it, through a supervisor outside the sandbox.
- **"Environment policy".** The sandbox gets a minimal allowlist of variables; `--env NAME` forwards one more. On Linux, bwrap's options, environment values included, go through an anonymous file descriptor, not bwrap's argv.
- **"Configuration".** The first ordinary run may write `.ai-jail` in the project; `--no-save-config` (`no_save_config`) stops it. A project `.ai-jail` can only tighten the policy.
- **"Useful options".** `--rw-map` and `--map` add read-write and read-only mounts; `--no-private-home` shares the real home instead of a tmpfs; `--dry-run` prints the backend invocation.
- **"Troubleshooting".** On Ubuntu 24.04 and later, AppArmor denies unprivileged user namespaces, which bwrap needs, and bwrap fails with "setting up uid map: Permission denied". The fixes it gives: set `kernel.apparmor_restrict_unprivileged_userns=0`, or install an AppArmor profile that leaves `/usr/bin/bwrap` unconfined with `userns`.
- **"Platform and threat model".** Neither backend protects against kernel or driver bugs, terminal emulator bugs, or every IPC and side channel.
- **"License".** GPL-3.0-only.
