---
title: "vllm/vllm-openai-cpu:v0.31.0"
url: https://hub.docker.com/r/vllm/vllm-openai-cpu/tags?name=v0.31.0
created_at: 2026-10-20T12:40:33-03:00
updated_at: 2026-10-20T12:40:33-03:00
tool: docs/web/tools/docker-hub.md
---

# vllm/vllm-openai-cpu:v0.31.0

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled. vLLM's CPU installation page points to this repository for its pre-built CPU images ([cpu.x86.inc.md](../vllm/docs-getting-started-installation-cpu-x86-inc-md-at-v0-31-0.md)).

## Tags

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.31.0` (linux/amd64 and linux/arm64) | `sha256:495c84fe30f3572b83a78100a1e8ba423dbb77fc532ecefebe114e6b77327bd9` | `sha256:8024248339dc6878daa5349344ed29d49c8a6732f6bdf7400fda32ce33e4b30b` | 1.57 GB, 16 layers |
| `v0.31.0-x86_64` (linux/amd64 only) | `sha256:8024248339dc6878daa5349344ed29d49c8a6732f6bdf7400fda32ce33e4b30b`, the manifest itself | Same | Same |

- `last_updated`: 2026-10-04 for both tags. The linux/arm64 image of `v0.31.0` is `sha256:045fb648a61cfcd32d4b9ca5d0c391013afadae0178d2e23ac292597f2f64036`, 1.09 GB.
- Newer tags at the time of recording: `v0.32.0` and `latest` (2026-10-18), and daily `nightly-<commit>` tags.

## Configuration of the linux/amd64 image

- **Entry point:** `["vllm", "serve"]`, no command, working directory `/vllm-workspace`, no `User` (root). Created 2026-10-03.
- **`PATH`:** starts with `/opt/venv/bin`, the virtual environment that holds `vllm` (`VIRTUAL_ENV=/opt/venv`).
- **`LD_PRELOAD`:** `/usr/lib/x86_64-linux-gnu/libtcmalloc_minimal.so.4:/opt/venv/lib/libiomp5.so`.
- **Compilers:** `CC=/usr/bin/gcc-15` and `CXX=/usr/bin/g++-15`.
- **Labels:**
  - `ai.vllm.build.cpu-x86` is `true` and `ai.vllm.build.target-arch` is `amd64`;
  - `ai.vllm.build.python-version` is `3.12`;
  - `org.opencontainers.image.title` is "vLLM CPU", and `org.opencontainers.image.version` is `22.04`;
  - `org.opencontainers.image.source` is `https://github.com/vllm-project/vllm`.
- It sets no CUDA variable.
