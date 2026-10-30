---
title: "vllm/vllm-openai:v0.32.0"
url: https://hub.docker.com/r/vllm/vllm-openai/tags?name=v0.32.0
created_at: 2026-10-30T17:20:00-03:00
updated_at: 2026-10-30T17:20:00-03:00
tool: docs/web/tools/docker-hub.md
---

# vllm/vllm-openai:v0.32.0

What Codeman relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

## Tags

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.32.0` (CUDA 13.0) | `sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34` | `sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9` | 9.21 GB, 40 layers |
| `v0.32.0-cu129` (CUDA 12.9) | `sha256:bc0445dac61accbf1c3b17fbb524a71eee0b1b32f55ba45952095e3be8991c3f` | `sha256:be7326dd2f0731b3c49bd7c09975b46323733dcac74757aa5d5ada60acdee217` | 11.18 GB |
| `v0.32.0-x86_64-zstd` (CUDA 13.0, zstd layers) | `sha256:9aa9a68bd05030a676652ebd41221263748acd055ff9f0f223d4b9e710d98b67` | `sha256:cbdab603ebf62b5aa08ed52c9f1d086f2c603cd875548d03f2c60f3a00630e93` | 7.30 GB |

- `v0.32.0` was last pushed on 2026-10-18T10:54:00Z (`tag_last_pushed`); it also has a linux/arm64 image.
- The index's digest is the SHA-256 of the bytes the registry serves for the tag (`Docker-Content-Digest`), and so is the linux/amd64 manifest's.
- The registry holds no cosign signature or attestation tag for the index (`sha256-<hex>.sig` and `.att` answer 404) and no referrers.

## Configuration of the linux/amd64 image

- **Created:** 2026-10-18T03:08:50Z (`created`).
- **Entry point:** `["vllm", "serve"]`, no command, working directory `/vllm-workspace`, no `User` (root).
- **CUDA:** `CUDA_VERSION=13.0.2` and `NVIDIA_REQUIRE_CUDA` starting `cuda>=13.0`, as `v0.31.0`; compatibility drivers 535 to 575 by brand after it.
- **GPU architectures:** `TORCH_CUDA_ARCH_LIST=7.5 8.0 8.6 8.9 9.0 10.0 12.0`, as `v0.31.0`.
- **Other variables:** `VLLM_ENABLE_CUDA_COMPATIBILITY=0`, `VLLM_USAGE_SOURCE=production-docker-image`, `NVIDIA_VISIBLE_DEVICES=all`, `NVIDIA_DRIVER_CAPABILITIES=compute,utility`; new since `v0.31.0`, `CRIU_CUDA_PLUGIN_DIR=/usr/local/lib/criu` and uv's settings (`UV_*`).
- **Labels:** `org.opencontainers.image.revision` and `ai.vllm.build.commit` give the commit built, `5df63a7203cdb9328d824a27b682e77c7b9928be`, the commit of the tag `v0.32.0` in `vllm-project/vllm`; `org.opencontainers.image.source` is `https://github.com/vllm-project/vllm`.
