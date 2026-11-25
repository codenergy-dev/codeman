---
title: "aquasec/trivy:0.76.0"
url: https://hub.docker.com/r/aquasec/trivy/tags?name=0.76.0
created_at: 2026-10-30T12:02:01-03:00
updated_at: 2026-10-30T12:02:01-03:00
tool: docs/web/tools/docker-hub.md
---

# aquasec/trivy:0.76.0

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `0.76.0` | `sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222` | `sha256:166061a4a15c64a94a3aab430659e2c166dc0815fbc54a222c6d56d64132f552` | 63 MB, 4 layers |

- `tag_last_pushed`: 2026-10-14T11:44:13Z, the day of the GitHub release v0.76.0. Newer at the time of recording: `0.76.1` and `latest` (2026-10-21), and `canary`.
- **Configuration:** Alpine 3.24.2's minimal root filesystem, with `ca-certificates`, `git` and `zlib` from `apk`, and the `trivy` binary in `/usr/local/bin` (history). Entry point `["trivy"]`; no `User` (root).
- **Labels:** `org.opencontainers.image.source` is `https://github.com/aquasecurity/trivy`, `org.opencontainers.image.revision` `531360e5d2a88e732373f1614ba99a38738538b8`, `org.opencontainers.image.version` `0.76.0`.
