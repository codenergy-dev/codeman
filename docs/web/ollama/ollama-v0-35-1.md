---
title: Ollama v0.35.1
url: https://github.com/ollama/ollama/releases/tag/v0.35.1
created_at: 2026-10-30T11:50:13-03:00
updated_at: 2026-10-30T11:50:13-03:00
tool: docs/web/tools/github-releases.md
---

# Ollama v0.35.1

The release of `ollama/ollama` that Codeman's Ollama pod image builds on, read from `GET /repos/ollama/ollama/releases/tags/v0.35.1`, `/git/ref/tags/v0.35.1`, `/commits/<sha>` and `/attestations/sha256:<digest>`.

| Fact | Value | Field |
| --- | --- | --- |
| Published | 2026-09-29T20:14:22Z | `published_at` |
| Immutable | No: its assets can still be replaced | `immutable` |
| Tag | Lightweight, pointing at commit `b0c1ca4f7549d7acdfa52a7dcffc934bc63a43ce` | `object.type`, `object.sha` of the ref |
| Commit | Verified (`valid`), committed by GitHub, so signed with GitHub's web-flow key | `commit.verification`, `commit.committer.name` |
| Checksums | `sha256sum.txt`, an asset of the same release; each linux-amd64 asset's line matches its `digest` | `assets[]` |
| Uploader | `github-actions[bot]` | `assets[].uploader.login` |
| Attestations | None for any linux-amd64 asset | `attestations` of `GET /repos/ollama/ollama/attestations/sha256:<digest>` |
| Repository advisories | None published | `GET /repos/ollama/ollama/security-advisories` |

| linux-amd64 asset | Size, bytes | `digest` |
| --- | --- | --- |
| `ollama-linux-amd64.tar.zst` | 1,439,658,961 | `sha256:9fcd79ac4575b2bd31b992eee18b1000c8ad126b451627c8f8cd091714cfbb10` |
| `ollama-linux-amd64-rocm.tar.zst` | 1,052,835,187 | `sha256:786e1ba2ed7877b48aa948315ab704da2ea54a4b636e0ca18c3d328c84ff22cf` |
| `ollama-linux-amd64-mlx.tar.zst` | 1,293,060,602 | `sha256:15ee9a52b60e22d62c3195c70d0a708fbaeb3decb393f2571cbd4e1079608e6b` |

The binary's Go modules are listed in `go.mod` at that commit (76 modules, the newest published more than 30 days before 2026-10-30). The bundled C/C++ and CUDA libraries under `lib/ollama` have no such manifest.
