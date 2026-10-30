---
title: "anchore/grype:v0.120.1"
url: https://hub.docker.com/r/anchore/grype/tags?name=v0.120.1
created_at: 2026-10-30T12:02:01-03:00
updated_at: 2026-10-30T12:02:01-03:00
tool: docs/web/tools/docker-hub.md
---

# anchore/grype:v0.120.1

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `v0.120.1` | `sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe` | `sha256:7bb1480f73d9a23b8e6137669c9b780389492778dc2da5c818d0add7e828ed45` | 32.5 MB, 3 layers |

- `tag_last_pushed`: 2026-10-06T20:46:14Z, the day of the GitHub release v0.120.1. Newer at the time of recording: `v0.121.0` and `latest` (2026-10-19), with `-debug` and `-nonroot` variants.
- **Configuration:** no base image: only `/etc/ssl/certs/ca-certificates.crt` and the `grype` binary at `/`, working directory `/tmp` (history). Entry point `["/grype"]`; no `User` (root).
- **Labels:** `org.opencontainers.image.source` is `https://github.com/anchore/grype`, `org.opencontainers.image.revision` `6f8d854af29d3a3086b11a84afa51554a2a245fe`, `org.opencontainers.image.licenses` `Apache-2.0`, `org.opencontainers.image.vendor` "Anchore, Inc.".
