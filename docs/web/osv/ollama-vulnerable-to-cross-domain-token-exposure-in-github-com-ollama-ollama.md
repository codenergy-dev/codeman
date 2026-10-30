---
title: "Ollama vulnerable to Cross-Domain Token Exposure in github.com/ollama/ollama"
url: https://osv.dev/vulnerability/GO-2025-3824
created_at: 2026-10-30T17:40:00-03:00
updated_at: 2026-10-30T17:40:00-03:00
tool: docs/web/tools/osv.md
---

# Ollama vulnerable to Cross-Domain Token Exposure in github.com/ollama/ollama

OSV.dev's record GO-2025-3824, from the Go vulnerability database, and its alias GHSA-x9hg-5q6g-q3jr, from GitHub's advisory database, read from `GET https://api.osv.dev/v1/vulns/<id>` on 2026-10-30. A record's text belongs to the database that published it, so this page holds, in Codeman's words, only what Codeman relies on.

| Fact | GO-2025-3824 (Go) | GHSA-x9hg-5q6g-q3jr (GitHub) | Field |
| --- | --- | --- | --- |
| Aliases | CVE-2025-51471, GHSA-x9hg-5q6g-q3jr | CVE-2025-51471, GO-2025-3824 | `aliases` |
| Published | 2025-07-30 | 2025-07-22 | `published` |
| Versions of `github.com/ollama/ollama` | introduced 0: every version, no fix | introduced 0, last_affected 0.9.6 | `affected[].ranges` |
| Severity | None given | moderate | `database_specific.severity` |
| Weakness | None given | CWE-345 | `database_specific.cwe_ids` |

- **What** (GHSA-x9hg-5q6g-q3jr's `details`, CVE-2025-51471): During `/api/pull`, a malicious registry's `WWW-Authenticate` header with a crafted `realm` makes `server.auth.getAuthorizationToken` send the authentication token to another domain.
- **For Ollama 0.35.1 to 0.40.13:** querying OSV.dev for `github.com/ollama/ollama` at 0.35.1, 0.40.10 or any release between them and up to 0.40.13 returns GO-2025-3824, since its range has no end; GitHub's record ends at 0.9.6.
