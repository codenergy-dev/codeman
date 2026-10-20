---
title: floci-gcp 0.11.0
url: https://github.com/floci-io/floci-gcp/releases/tag/0.11.0
created_at: 2026-10-20T12:35:32-03:00
updated_at: 2026-10-20T12:35:32-03:00
tool: docs/web/tools/github-releases.md
---

# floci-gcp 0.11.0

The latest release of `floci-io/floci-gcp`, a local emulator of Google Cloud APIs, when recorded, and the repository's facts from GitHub's API. This page holds, in Codeman's words, only what Codeman relies on.

## The release

- **`published_at`.** 2026-10-15, by `hectorvent`. Its tag points at commit `0fa563c603c1876a09b050ffdce0d96bac00fedc`.
- **Earlier releases.** Ten releases from 0.2.1 (2026-06-04) to 0.11.0, one every one to three weeks.
- **`assets`.** None: the release ships no files. The emulator is distributed as the image [`floci/floci-gcp:0.11.0`](floci-floci-gcp-0-11-0.md), or built from source.
- **Notes.** The changes are bug fixes and features of single services, such as BigQuery and Cloud Run; none names STS, IAM Credentials or Firestore.

## The repository

- **`license`.** MIT, for the code and the `docs/` directory alike (one `LICENSE` file at the root).
- **`created_at`.** 2026-05-17. **`pushed_at`.** 2026-10-20. **`archived`.** false.
- **`stargazers_count`.** 457. **`forks_count`.** 106. **`open_issues_count`.** 52.
- **`language`.** Java (Quarkus 3.39.5 in `pom.xml`, 46 declared dependencies).
- **`/contributors`.** 31 accounts. One holds 145 commits; the next holds 31.
- **`/commits`.** At least 100 commits in the month before 2026-10-20.
- **`/security-advisories`.** None published.

## The organization

- `floci-io` also publishes `floci`, an AWS emulator (26,961 stars, created 2026-02-18), and emulators of Azure and Oracle Cloud.
- `floci-io/floci`'s `/security-advisories` lists four advisories published in September 2026, two of them critical: unauthenticated remote code execution, one through a host bind mount reached with the Docker socket.
