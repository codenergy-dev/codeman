---
title: "vllm/vllm-omni:v0.30.0"
url: https://hub.docker.com/r/vllm/vllm-omni/tags?name=v0.30.0
created_at: 2026-10-30T11:47:43-03:00
updated_at: 2026-10-30T11:47:43-03:00
tool: docs/web/tools/docker-hub.md
---

# vllm/vllm-omni:v0.30.0

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

## Tag

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.30.0` | `sha256:fc77cfaac7b1b43c30cbf32eaea214864434c6e0f303e6e9eb9f64104241a994` | `sha256:b09c9eab7d2e30817208de92ccb482756d13d4339377d7cc4c4ce9f47bf04174` | 9.43 GB (9,429,963,693 bytes), 43 layers |

- `tag_last_pushed`: 2026-09-27T14:34:40Z. Newer at the time of recording: `v0.31.0rc1` (2026-10-06), `v0.32.0rc1` (2026-10-22), `v0.32.0` and `latest` (2026-10-28), daily `nightly-<commit>` tags, and model tags such as `qwen-image21` and `flux-3-image-klein`. No `v0.31.0` release tag.

## Configuration of the linux/amd64 image

- **Base:** `vllm/vllm-openai:v0.30.0` (environment `VLLM_IMAGE_TAG` and label `org.opencontainers.image.version`), on NVIDIA's CUDA 13.0.2 image (`CUDA_VERSION`); the vLLM image's steps are its first ones (history).
- **Entry point:** the vLLM image's `["vllm", "serve"]`, then reset to `[]` by the last step; no command. A container needs a command of its own. No `User` (root). Working directory `/app`. Created 2026-09-25.
- **Its own steps:** `apt-get install -y git jq`; vLLM-Omni's sources copied to `/app/vllm-omni` and installed with `uv pip install` into the image's Python; `/usr/bin/python` linked to `python3` (history).
- **A non-root user:** the vLLM steps add a user of UID 2000 in group 0 and `/usr/local/bin/vllm-nonroot-entrypoint.sh`, which the image does not use by default (history).
- **Labels:** inherited from the vLLM image: `org.opencontainers.image.source` is `https://github.com/vllm-project/vllm`, `org.opencontainers.image.revision` `ced6857afa0ea7b2e3f0846a62e1394e90f15607`. None names vLLM-Omni.
