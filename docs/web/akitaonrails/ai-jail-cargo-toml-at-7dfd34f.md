---
title: "ai-jail: Cargo.toml at 7dfd34f"
url: https://github.com/akitaonrails/ai-jail/blob/7dfd34ff66b914a41b05f79b12b6b117d5ce9fe0/Cargo.toml
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-repositories.md
---

# ai-jail: Cargo.toml at 7dfd34f

The Rust manifest of `akitaonrails/ai-jail` at commit `7dfd34f`, the head of `master` on 2026-10-17. The repository is GPL-3.0-only, which the [GitHub repositories](../tools/github-repositories.md) tool does not copy in full, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **`[package]`.** Version `2.10.0`, edition 2024, `license = "GPL-3.0-only"`. Its description: a sandbox for AI coding agents, bubblewrap on Linux and `sandbox-exec` on macOS.
- **`[dependencies]`.** `lexopt`, `serde`, `toml`, `serde_json`, `vt100`, `sha2`, `rustls` (with `ring`), `webpki-roots`; on Unix `nix`; on Linux `landlock` and `seccompiler`. Versions are ranges (such as `"0.29"`); `Cargo.lock` pins them, and lists 70 packages, `ai-jail` included.
- **`[features]`.** `test-hooks` turns off the egress proxy's guard against private addresses, for tests only; a release build does not enable it.
- **`[profile.release]`.** `strip = true`, `lto = true`.
- **No build script.** The manifest has no `build` key; the crates it depends on may have their own.
