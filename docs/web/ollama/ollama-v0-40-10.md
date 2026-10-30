---
title: Ollama v0.40.10
url: https://github.com/ollama/ollama/releases/tag/v0.40.10
created_at: 2026-10-30T18:10:00-03:00
updated_at: 2026-10-30T18:10:00-03:00
tool: docs/web/tools/github-releases.md
---

# Ollama v0.40.10

A release of `ollama/ollama` after 0.35.1, read from `GET /repos/ollama/ollama/releases?per_page=40`, `/git/ref/tags/v0.40.10`, `/commits/<sha>`, and the raw files at the tag.

| Fact | Value | Field or file |
| --- | --- | --- |
| Published | 2026-10-23T15:03:59Z | `published_at` |
| Immutable | No | `immutable` |
| Tag | Lightweight, pointing at commit `f52b9e742d8c9a308f7b23cd1f0ab52c7ddb694d` | `object.type`, `object.sha` of the ref |
| Commit | Verified (`valid`), committed by GitHub | `commit.verification`, `commit.committer.name` |
| Go | `go 1.26.10`, against `go 1.26.0` at v0.35.1 | `go.mod` |
| Modules | `golang.org/x/crypto` v0.58.0, `x/net` v0.61.0, `x/text` v0.43.0, `x/image` v0.47.0, `x/mod` v0.42.0, `klauspost/compress` v1.20.3, `buger/jsonparser` v1.1.2; at v0.35.1, v0.43.0, v0.46.0, v0.30.0, v0.22.0, v0.30.0, v1.18.3 and v1.1.1 | `go.mod` |
| llama.cpp | `b11803`, against `b11232` at v0.35.1 | `LLAMA_CPP_VERSION` |
| License | MIT, unchanged | `LICENSE` |

## Between v0.35.1 and v0.40.10

From the release notes of v0.40.0 to v0.40.10 (`body`) and the files at both tags:

- **Server variables:** `envconfig/config.go` is byte for byte the same at both tags.
- **Families served one request at a time:** the list in `load` of `server/sched.go` is the same.
- **Memory:** `server/sched.go` replaces its fixed batch surcharge (`generationBatchSurcharge`) with `llm.LlamaServerBatch` and `llm.LlamaServerBatchMemory`, and records which runner (`ggml`, `llamacpp` or MLX) serves a model.
- **Runners:** from v0.40.2, models downloaded by an earlier version are upgraded in the background to run on llama.cpp, keeping the original as a backup ("Model upgrades"). v0.40.4, v0.40.5 and v0.40.7 update llama.cpp; v0.40.7 lets `llama-server` infer a draft model's type.
- **Security:** no release note names a security fix or an advisory.
