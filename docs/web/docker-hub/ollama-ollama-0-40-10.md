---
title: "ollama/ollama:0.40.10"
url: https://hub.docker.com/r/ollama/ollama/tags?name=0.40.10
created_at: 2026-10-30T18:10:00-03:00
updated_at: 2026-10-30T18:10:00-03:00
tool: docs/web/tools/docker-hub.md
---

# ollama/ollama:0.40.10

What Codeman relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

- **Digests:** index `sha256:4c5b27871a3239a717048f9b93057680a51b60c8119a7016aebb57f938e25e35`; linux/amd64 manifest `sha256:ca389885d4c03971d9bdc1c082452c128819b48425b5633c73d7b208b1e3d11a`. Each is the SHA-256 of the bytes the registry serves.
- **Size:** 3.37 GB compressed for linux/amd64, in 4 layers; also a linux/arm64 image.
- **Dates:** created 2026-10-23T16:34:45Z (`created`), last pushed 2026-10-23T16:43:00Z (`tag_last_pushed`).
- **Configuration:** entry point `["/bin/ollama"]`, command `["serve"]`, no `User` (root). It sets `OLLAMA_HOST=0.0.0.0:11434` and no `NVIDIA_REQUIRE_CUDA`, as 0.35.1's.
- **Labels:** only `org.opencontainers.image.version` `24.04`, the Ubuntu base's: no source or revision label.
- **Signatures:** no `sha256-<hex>.sig` or `.att` tag, no referrers.
