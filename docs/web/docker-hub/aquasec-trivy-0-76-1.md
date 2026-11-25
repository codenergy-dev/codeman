---
title: "aquasec/trivy:0.76.1"
url: https://hub.docker.com/r/aquasec/trivy/tags?name=0.76.1
created_at: 2026-10-30T17:20:00-03:00
updated_at: 2026-10-30T17:20:00-03:00
tool: docs/web/tools/docker-hub.md
---

# aquasec/trivy:0.76.1

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

| Tag | Index digest | linux/amd64 manifest | linux/amd64 size |
| --- | --- | --- | --- |
| `0.76.1` | `sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c` | `sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df` | 63 MB, 4 layers |

- `tag_last_pushed`: 2026-10-21T11:16:45Z, the day of the GitHub release v0.76.1 (11:18:34Z, `immutable: true`). Also linux/arm64, ppc64le and s390x images.
- **Configuration:** created 2026-10-21T11:16:20Z (`created`). Entry point `["trivy"]`; no `User` (root).
- **Labels:** `org.opencontainers.image.source` is `https://github.com/aquasecurity/trivy`, `org.opencontainers.image.revision` `e713f67f7d54decdcd9b3132c9751833dcced698` (the release's commit "release: v0.76.1", per its changelog), `org.opencontainers.image.version` `0.76.1`.
- **Signatures:** the registry's referrers API lists two Sigstore bundles (`application/vnd.dev.sigstore.bundle.v0.3+json`) for the index; no `sha256-<hex>.sig` tag. They were not verified.
- **The release** (`GET /repos/aquasecurity/trivy/releases/tags/v0.76.1`, `body`): built with Go 1.27.3, which distrusts the eMudhra intermediates whose keys were compromised (CVE-2026-111943), and with Alpine's updated CA store; otherwise dependency backports.
