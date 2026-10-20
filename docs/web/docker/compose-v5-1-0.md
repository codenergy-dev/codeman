---
title: compose v5.1.0
url: https://github.com/docker/compose/releases/tag/v5.1.0
created_at: 2026-10-20T19:06:41-03:00
updated_at: 2026-10-20T19:06:41-03:00
tool: docs/web/tools/github-releases.md
---

# compose v5.1.0

The release of `docker/compose` that Docker Desktop 4.66.1 bundles on the machine of the [end-to-end test suite plan](../../plans/2026-10-20-end-to-end-test-suite.md) (`docker compose version` prints `v5.1.0`), and the repository's facts from GitHub's API. This page holds, in Codeman's words, only what Codeman relies on. No file was downloaded: the binary comes with Docker Desktop.

## The release

- **`published_at`.** 2026-02-24. Newer releases at the time of recording: v5.5.1 (2026-09-03) and v5.6.0 (2026-10-02).
- **`assets`.** Per platform, the binary (`docker-compose-linux-x86_64`, 31,544,095 bytes, `digest` `sha256:5633cb21e06a7c88c7ca48a9334d3d0f7f892e9605ae9e9a45f9a095d4ffceb8`), a `.sha256` file, a `.provenance.json`, an `.sbom.json` and a `.sigstore.json`; and one `checksums.txt` for all.
- **Notes.** Bug fixes and internal changes; one change builds and signs the binaries with Docker's GitHub builder.

## The repository

- **`license`.** Apache-2.0.
- **`created_at`.** 2013-12-09. **`pushed_at`.** 2026-10-20. **`archived`.** false. **`stargazers_count`.** 38,413.
- **`/contributors`.** Led by Docker's maintainers: the top three accounts hold 1,777, 1,017 and 828 commits.
- **`/security-advisories`.** One published: CVE-2025-62725 (high), a path traversal through OCI artifact layer annotations, fixed in v2.40.2.
