---
title: "remote code execution possible -- actions/cache server allows malicious cache injection"
url: https://github.com/nektos/act/security/advisories/GHSA-x34h-54cw-9825
created_at: 2026-10-19T14:32:43-03:00
updated_at: 2026-10-19T14:32:43-03:00
tool: docs/web/tools/github-security-advisories.md
---

# remote code execution possible -- actions/cache server allows malicious cache injection

Advisory GHSA-x34h-54cw-9825 of `nektos/act`, CVE-2026-34042, severity high, published on 2026-03-25. An advisory's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## Description

- act's built-in server for `actions/cache` listens on every interface, without authentication.
- Anyone who reaches it can read every cache, and create caches under any key. A cache whose key a job will use can hold files that then run in the job's container.

## Affected versions

`github.com/nektos/act` up to 0.2.85; fixed in 0.2.86. Gitea's `act_runner`, a fork, is listed as affected in every version, with no fix (the advisory's package list).
