---
title: "lmsysorg/sglang:v0.5.22"
url: https://hub.docker.com/r/lmsysorg/sglang/tags?name=v0.5.22
created_at: 2026-10-30T11:47:43-03:00
updated_at: 2026-10-30T11:47:43-03:00
tool: docs/web/tools/docker-hub.md
---

# lmsysorg/sglang:v0.5.22

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

## Tag

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.5.22` | `sha256:e3a4f06001a29542fc4a8638536d9ffc5eb9c9942b08603c09b19a56eae4a1ae` | `sha256:5fc09edb6a0bb1d5b6992b543723c66d08f86d7a507e951e87e0d05db4ac766e` | 15.6 GB (15,617,393,790 bytes), 69 layers |

- `tag_last_pushed`: 2026-10-16T00:36:01Z. The runtime variant `v0.5.22-runtime` is 14.4 GB; `v0.5.21` (2026-10-01) is 15.2 GB.
- Newer at the time of recording: `v0.5.23` and `latest` (2026-10-30), and daily `nightly-*` and `dev-*` tags.

## Configuration of the linux/amd64 image

- **Entry point:** `["/opt/nvidia/nvidia_entrypoint.sh"]`, NVIDIA's CUDA base entry point; no command. No `User` (root). Working directory `/sgl-workspace/sglang`. Created 2026-10-16.
- **Base:** NVIDIA's CUDA 13.0.3 image on Ubuntu 24.04 (`CUDA_VERSION`, `NVIDIA_REQUIRE_CUDA` of `cuda>=13.0`; label `maintainer` NVIDIA). Its first layer's `/usr/lib/os-release` is Ubuntu 24.04.4 LTS, and its `/var/lib/dpkg/status` has `libc6` 2.39-0ubuntu8.7; no later step runs `apt-get upgrade` (history).
- **Tools:** the CUDA base installs `curl` and purges it in the same step; a later step installs `curl`, `wget`, `perl`, `git-lfs`, `build-essential` and `openssh-server` among others (history).
- **Python:** a virtual environment in `/opt/sglang` (`VIRTUAL_ENV`, first on `PATH` after `/root/.cargo/bin`), from a Python that `uv` manages in `/opt/python` (`UV_PYTHON_INSTALL_DIR`, `UV_PYTHON_PREFERENCE=only-managed`).
- **Locale:** `LC_ALL` and `LANG` are `en_US.UTF-8`.
- **Labels:** `org.opencontainers.image.source` is `https://github.com/sgl-project/sglang`, `org.opencontainers.image.revision` is `baa9befa381511cd4d56f83980951e5a45fffc6d`, and `org.opencontainers.image.url` its GitHub Actions run.
