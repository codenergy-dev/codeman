---
title: "ubuntu:resolute-20261105.1"
url: https://hub.docker.com/_/ubuntu/tags?name=resolute-20261105.1
created_at: 2026-11-25T13:00:38-03:00
updated_at: 2026-11-25T13:00:38-03:00
tool: docs/web/tools/docker-hub.md
---

# ubuntu:resolute-20261105.1

What Codeman relies on, in its own words, from Docker Hub's tag API and the registry (see the tool). The local runner image builds on this tag.

- **Tags:** `resolute-20261105.1` was also `26.04`, `resolute` and `latest` on 2026-11-25 (same index digest). Its `last_updated` and `tag_last_pushed` are 2026-11-16; its linux/amd64 image was pushed on 2026-11-12. The configuration's label `org.opencontainers.image.created` is 2026-11-06, and `org.opencontainers.image.version` is `26.04`.
- **Digests:** index `sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db`; linux/amd64 manifest `sha256:0d5255be560e2d2ddcfbfda88549e9e815ef29e7cd7fc62183d5709e6e2963c6`; linux/arm64 `sha256:7e7957462d7b6db141de67623f46135d82a6bc131bc2ff369aedfccfa91c0a1b`. The index and the linux/amd64 manifest, read from the registry, hash to these digests.
- **Size:** 42.2 MB compressed for linux/amd64, 41.1 MB for linux/arm64.
- **Configuration:** `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, command `/bin/bash`.
- **Contents, read from the image on 2026-11-25:** Ubuntu 26.04.1 LTS. `coreutils` 9.5-1ubuntu2+0.0.0~ubuntu25 with `coreutils-from-uutils` 0.0.0~ubuntu25, `rust-coreutils` 0.10.0-1ubuntu2~26.04.1 and `gnu-coreutils` 9.7-3ubuntu2.1. No `sudo`, `sudo-rs` or `bubblewrap`. The user `ubuntu`, uid 1000.
