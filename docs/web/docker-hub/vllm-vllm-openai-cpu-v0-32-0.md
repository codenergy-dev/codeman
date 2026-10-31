---
title: "vllm/vllm-openai-cpu:v0.32.0"
url: https://hub.docker.com/r/vllm/vllm-openai-cpu/tags?name=v0.32.0
created_at: 2026-10-30T21:13:26-03:00
updated_at: 2026-10-30T21:13:26-03:00
tool: docs/web/tools/docker-hub.md
---

# vllm/vllm-openai-cpu:v0.32.0

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled. vLLM's CPU installation page points to this repository for its pre-built CPU images ([cpu.x86.inc.md](../vllm/docs-getting-started-installation-cpu-x86-inc-md-at-v0-32-0.md)).

## Tags

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.32.0` (linux/amd64 and linux/arm64) | `sha256:ffaba3989b9b96d95a576143c872a4110ce9800f5199b6a36eb27bdff1cbbe05` | `sha256:827ef38187f9b52f2bb838695ef815ec5b65f4bf3e4c061b002b2b0a19cb0701` | 1.72 GB, 16 layers |
| `v0.32.0-x86_64` (linux/amd64 only) | `sha256:827ef38187f9b52f2bb838695ef815ec5b65f4bf3e4c061b002b2b0a19cb0701`, the manifest itself | Same | Same |

- `digest` of the tag is the SHA-256 of the index the registry serves, and each manifest's digest the SHA-256 of its bytes (checked with `shasum -a 256`).
- `last_updated`: 2026-10-18T10:30:22Z for `v0.32.0`, 2026-10-18T10:27:55Z for `v0.32.0-x86_64`; the linux/amd64 image's `last_pushed` is 2026-10-18T10:27:53Z. The linux/arm64 image of `v0.32.0` is `sha256:433cbee5e0b689095484090454b6fcdf0c68fe3eabfbb251a5e39d442917a4a6`, 1.24 GB.
- Newer tags at the time of recording: only daily `nightly-<commit>` tags.

## Configuration of the linux/amd64 image

- **Entry point:** `["vllm", "serve"]`, no command, working directory `/vllm-workspace`, no `User` (root). Created 2026-10-18T03:02:50Z.
- **`PATH`:** starts with `/opt/venv/bin`, the virtual environment that holds `vllm` (`VIRTUAL_ENV=/opt/venv`).
- **`LD_PRELOAD`:** `/usr/lib/x86_64-linux-gnu/libtcmalloc_minimal.so.4:/opt/venv/lib/libiomp5.so`.
- **Compilers:** `CC=/usr/bin/gcc-15` and `CXX=/usr/bin/g++-15`.
- **New since v0.31.0:** `UV_COMPILE_BYTECODE=1`, so Python's bytecode is compiled when the image is built.
- **Labels:**
  - `ai.vllm.build.cpu-x86` is `true`, `ai.vllm.build.cpu-arm-bf16` is `false` and `ai.vllm.build.target-arch` is `amd64`;
  - `ai.vllm.build.python-version` is `3.12`;
  - `org.opencontainers.image.title` is "vLLM CPU", and `org.opencontainers.image.version` is `22.04`;
  - `org.opencontainers.image.source` is `https://github.com/vllm-project/vllm`; no revision label.
- It sets no CUDA variable.
