---
title: "[Ubuntu] `ubuntu-latest` label will use Ubuntu 26.04 in November 2026"
url: https://github.com/actions/runner-images/issues/14748
created_at: 2026-11-24T12:33:00-03:00
updated_at: 2026-11-24T12:33:00-03:00
tool: docs/web/tools/github-repositories.md
---

# [Ubuntu] `ubuntu-latest` label will use Ubuntu 26.04 in November 2026

Issue 14748 of `actions/runner-images`, opened on 2026-09-17 and still open when recorded, last updated on 2026-11-24. An issue's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **The change.** The x64 `ubuntu-latest` label moves from Ubuntu 24.04 to Ubuntu 26.04, rolled out over several weeks from 2026-10-19, to be complete by 2026-11-19. The arm64 images are not affected.
- **What differs, by the issue's table.** Ubuntu 24.04.5 to 26.04.1; kernel 6.17.0-1022-azure to 7.0.0-1012-azure; systemd 255.4-1ubuntu8.17 to 259.5-0ubuntu3.4. The image's README is the full list ([at e015a08](runner-images-ubuntu2604-readme-md-at-e015a08.md), which already reports systemd 259.9-0ubuntu0.1 and kernel 7.0.0-1020-azure).
- **Mitigation.** A workflow goes back to Ubuntu 24.04 with the `ubuntu-24.04` label, and tests the new image with `ubuntu-26.04`.
