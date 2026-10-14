---
title: "vllm/vllm-openai:v0.31.0"
url: https://hub.docker.com/r/vllm/vllm-openai/tags?name=v0.31.0
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/docker-hub.md
---

# vllm/vllm-openai:v0.31.0

What Codeman relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

## Tags

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.31.0` (CUDA 13.0) | `sha256:c1c9f6fd5c109ba7f0546a59f5b2f15fb87f64c77782e90a27b648b42a8e67c3` | `sha256:a4a4c0437bf7240089da5f08aa370c4aee17ae5290f7a3b468825ee26c4c3a6b` | 9.04 GB, 40 layers |
| `v0.31.0-cu129` (CUDA 12.9) | `sha256:ff29e51a9457f191deb332b96fa6440584fa941aa2a548449b604e2b1e5e1eeb` | `sha256:b18abb2df97b8f798e81862bd93f872ea18613372e2c3adc0cc2ac21e66ac12f` | 11.02 GB, 40 layers |
| `v0.31.0-x86_64-zstd` (CUDA 13.0, zstd layers) | `sha256:017d6959239eec662c0f6b05e1f6bf5a33b69d4b6cd701236e289defbc2c081a` | `sha256:351d962c2234b1e3ca4d6abc6bab17f9ebfc41c15cf546f3fdbe53084867655a` | 7.16 GB |

The `v0.31.0` and `v0.31.0-cu129` tags were last pushed on 2026-10-04 (`last_updated`); both also have a linux/arm64 image.

## Configuration of the linux/amd64 images

- **Entry point:** `["vllm", "serve"]`, no command, working directory `/vllm-workspace`, no `User` (root).
- **CUDA:** `CUDA_VERSION=13.0.2` and `NVIDIA_REQUIRE_CUDA` starting `cuda>=13.0` for `v0.31.0`; `CUDA_VERSION=12.9.1` and `cuda>=12.9` for `v0.31.0-cu129`. Both list compatibility drivers 535 by brand after it.
- **GPU architectures:** `TORCH_CUDA_ARCH_LIST=7.5 8.0 8.6 8.9 9.0 10.0 12.0`, so compute capability 12.0 (the RTX PRO 6000 Blackwell and RTX 50 series) among them.
- **Other variables:** `VLLM_ENABLE_CUDA_COMPATIBILITY=0`, `VLLM_USAGE_SOURCE=production-docker-image`, `NVIDIA_VISIBLE_DEVICES=all`, `NVIDIA_DRIVER_CAPABILITIES=compute,utility`.
- **Labels:** `org.opencontainers.image.revision` and `ai.vllm.build.commit` give the commit built, `db9527a46873454610df6dbedf79a36d6bf1a7f6`; `org.opencontainers.image.source` is `https://github.com/vllm-project/vllm`.
