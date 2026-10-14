---
title: "ollama/ollama:0.35.1"
url: https://hub.docker.com/r/ollama/ollama/tags?name=0.35.1
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
tool: docs/web/tools/docker-hub.md
---

# ollama/ollama:0.35.1

What Codeman relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Codeman's pod image for Ollama builds on this tag.

- **Digests:** index `sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c`; linux/amd64 manifest `sha256:17e945f1aa6e505707eeb621e3f36847d0a4a063d4778f7007645acccfb8bd4f`.
- **Size:** 3.78 GB compressed for linux/amd64, in 4 layers.
- **Configuration:** entry point `["/bin/ollama"]`, command `["serve"]`. It sets no `NVIDIA_REQUIRE_CUDA`, so the container runtime puts no CUDA floor on the host.
