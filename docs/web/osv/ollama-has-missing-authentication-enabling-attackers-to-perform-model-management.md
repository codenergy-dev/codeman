---
title: "Ollama has missing authentication enabling attackers to perform model management operations in github.com/ollama/ollama"
url: https://osv.dev/vulnerability/GO-2025-4251
created_at: 2026-10-30T17:40:00-03:00
updated_at: 2026-10-30T17:40:00-03:00
tool: docs/web/tools/osv.md
---

# Ollama has missing authentication enabling attackers to perform model management operations in github.com/ollama/ollama

OSV.dev's record GO-2025-4251, from the Go vulnerability database, and its alias GHSA-f6mr-38g8-39rg, from GitHub's advisory database, read from `GET https://api.osv.dev/v1/vulns/<id>` on 2026-10-30. A record's text belongs to the database that published it, so this page holds, in Codeman's words, only what Codeman relies on.

| Fact | GO-2025-4251 (Go) | GHSA-f6mr-38g8-39rg (GitHub) | Field |
| --- | --- | --- | --- |
| Aliases | CVE-2025-63389, GHSA-f6mr-38g8-39rg | CVE-2025-63389, GO-2025-4251 | `aliases` |
| Published | 2026-01-14 | 2025-12-18 | `published` |
| Versions of `github.com/ollama/ollama` | introduced 0: every version, no fix | introduced 0, last_affected 0.13.5 | `affected[].ranges` |
| Severity | None given | critical | `database_specific.severity` |
| Weakness | None given | CWE-284, CWE-306 | `database_specific.cwe_ids` |

- **What** (GHSA-f6mr-38g8-39rg's `details`, CVE-2025-63389): The API's endpoints require no authentication, so anyone who reaches the server can manage its models.
- **For Ollama 0.35.1:** querying OSV.dev for `github.com/ollama/ollama` at 0.35.1, and at every release up to 0.40.13, returns GO-2025-4251, since its range has no end; GitHub's record ends at 0.13.5.
