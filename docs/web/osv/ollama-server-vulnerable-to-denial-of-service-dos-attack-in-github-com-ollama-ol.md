---
title: "Ollama Server Vulnerable to Denial of Service (DoS) Attack in github.com/ollama/ollama"
url: https://osv.dev/vulnerability/GO-2025-3695
created_at: 2026-10-30T17:40:00-03:00
updated_at: 2026-10-30T17:40:00-03:00
tool: docs/web/tools/osv.md
---

# Ollama Server Vulnerable to Denial of Service (DoS) Attack in github.com/ollama/ollama

OSV.dev's record GO-2025-3695, from the Go vulnerability database, and its alias GHSA-wrh5-cmwx-q2qr, from GitHub's advisory database, read from `GET https://api.osv.dev/v1/vulns/<id>` on 2026-10-30. A record's text belongs to the database that published it, so this page holds, in Codeman's words, only what Codeman relies on.

| Fact | GO-2025-3695 (Go) | GHSA-wrh5-cmwx-q2qr (GitHub) | Field |
| --- | --- | --- | --- |
| Aliases | CVE-2025-1975, GHSA-wrh5-cmwx-q2qr | CVE-2025-1975, GO-2025-3695 | `aliases` |
| Published | 2025-05-22 | 2025-05-16 | `published` |
| Versions of `github.com/ollama/ollama` | introduced 0: every version, no fix | introduced 0, last_affected 0.5.11 | `affected[].ranges` |
| Severity | None given | high | `database_specific.severity` |
| Weakness | None given | CWE-129 | `database_specific.cwe_ids` |

- **What** (GHSA-wrh5-cmwx-q2qr's `details`, CVE-2025-1975): Pulling a model through `/api/pull` from a spoofed service whose manifest is crafted indexes an array out of range and crashes the server: a denial of service.
- **For Ollama 0.35.1:** querying OSV.dev for `github.com/ollama/ollama` at 0.35.1, and at every release up to 0.40.13, returns GO-2025-3695, since its range has no end; GitHub's record ends at 0.5.11.
