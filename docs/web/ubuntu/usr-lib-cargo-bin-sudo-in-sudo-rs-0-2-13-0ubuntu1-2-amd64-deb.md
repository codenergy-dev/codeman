---
title: "/usr/lib/cargo/bin/sudo in sudo-rs_0.2.13-0ubuntu1.2_amd64.deb"
url: http://archive.ubuntu.com/ubuntu/pool/main/r/rust-sudo-rs/sudo-rs_0.2.13-0ubuntu1.2_amd64.deb
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/ubuntu-archive.md
---

# /usr/lib/cargo/bin/sudo in sudo-rs_0.2.13-0ubuntu1.2_amd64.deb

`sudo-rs`, a reimplementation of `sudo` in Rust, as Ubuntu 26.04's `resolute-updates` served it. The package's SHA-256, `4cc5c72548a0e192dffb1eea4057b49acf0305e5bbc35266ffabe9cc4a92ef97`, matched the one in `dists/resolute-updates/main/binary-amd64/Packages.gz`, whose own SHA-256 matched the suite's `Release`. Its manual `sudoers-rs.5` was read from the same package. This page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Which `sudo` runs.** The package's `postinst` registers `/usr/lib/cargo/bin/sudo` as the `sudo` alternative of `/usr/bin/sudo` with priority 50; `sudo` 1.9.17p2-1ubuntu3.2 registers `/usr/bin/sudo.ws` with 40. So, with both installed and no choice made, `/usr/bin/sudo` is `sudo-rs`. `sudo-rs` has `Priority: important` in the archive's index and is in the `minimal` and `server-minimal` tasks; `ubuntu-minimal` depends on `sudo` and `sudo-rs`.
- **The binary.** `/usr/lib/cargo/bin/sudo` is `-rwsr-xr-x root root`, by the data archive's listing.
- **Its sudoers.** It reads `/etc/sudoers` from `sudo-common` ([the file](etc-sudoers-in-sudo-common-1-2ubuntu-all-deb.md)), and supports `secure_path`, `use_pty` and `@includedir`. In `sudo-rs`, `env_reset` cannot be turned off: commands run with a new, minimal environment ("Command environment" in `sudoers-rs.5`).

The runner image's README lists `sudo` 1.9.17p2-1ubuntu3.2 among its installed apt packages, and not `sudo-rs` ([README at e015a08](../github/runner-images-ubuntu2604-readme-md-at-e015a08.md)); that list names the packages the image's scripts install, not those of its base system. Which `sudo` the runner runs is for CI to show.
