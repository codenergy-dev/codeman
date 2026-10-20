---
title: "floci/floci-gcp:0.11.0"
url: https://hub.docker.com/r/floci/floci-gcp/tags?name=0.11.0
created_at: 2026-10-20T12:35:32-03:00
updated_at: 2026-10-20T12:35:32-03:00
tool: docs/web/tools/docker-hub.md
---

# floci/floci-gcp:0.11.0

What Codeman relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool).

- **Digests:** index `sha256:eae9683d806ceb643bcb36aee97cdb8cad13c3e2959cd053bf40e481994fde12`; linux/amd64 manifest `sha256:e78122803e9ba0eb87ac55f0a78982399b198f86b547ccfa6bd1c918ea72cca0`; linux/arm64 manifest `sha256:3defb6e4b037c9ea0555e719c38ea5840159c15145a1872dc651b0c6bc9b2bbb`.
- **Size:** 64.6 MB compressed for linux/amd64, in 6 layers; 63.3 MB for linux/arm64.
- **Source:** label `org.opencontainers.image.revision` is `0fa563c603c1876a09b050ffdce0d96bac00fedc`, the commit of [the 0.11.0 release](floci-gcp-0-11-0.md); `org.opencontainers.image.version` is `0.11.0`.
- **Configuration:** `User` is unset, so the entry point `/usr/local/bin/docker-entrypoint.sh` starts as root; command `["/app/application", "-Dquarkus.http.host=0.0.0.0"]`, a native executable. Port `4588/tcp`, volume `/app/data`.
- **Docker Hub:** `pull_count` 154,373; registered 2026-05-23.
