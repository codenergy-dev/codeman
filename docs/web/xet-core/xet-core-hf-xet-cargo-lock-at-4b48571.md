---
title: "xet-core: hf_xet/Cargo.lock at 4b48571"
url: https://github.com/huggingface/xet-core/blob/4b485713577a8f25d015953046210dc3d5d25ea5/hf_xet/Cargo.lock
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# xet-core: hf_xet/Cargo.lock at 4b48571

The commit of the tag `v1.7.0`, the `hf_xet` in vLLM 0.32.0's images: the Rust extension that `huggingface_hub` downloads files stored with Xet through. What Codeman relies on, in its own words: the file is larger than the repository should hold (106 KB).

## Its TLS stack

| Crate | Version | Role |
| --- | --- | --- |
| `reqwest` | 0.13.2 | The HTTP client; it depends on `hyper-rustls` and `rustls-platform-verifier` |
| `rustls` | 0.23.45 | TLS, with rustls as the default feature ([xet_client/Cargo.toml](xet-core-xet-client-cargo-toml-at-4b48571.md)) |
| `rustls-platform-verifier` | 0.6.2 | Verifies certificates with the platform's roots ([others.rs](../rustls/rustls-platform-verifier-rustls-platform-verifier-src-verification-others-rs-at.md)) |
| `rustls-native-certs` | 0.8.3 | Loads those roots on Linux, from `SSL_CERT_FILE` and `SSL_CERT_DIR` when set ([lib.rs](../rustls/rustls-native-certs-src-lib-rs-at-71e4dd8.md)) |
| `openssl-probe` | 0.2.1 | Finds the system's store when neither variable is set |

`webpki-root-certs`, a bundled copy of Mozilla's roots, is locked too: `rustls-platform-verifier` depends on it only for `wasm32` and in its tests (its `Cargo.toml` at the same tag).
