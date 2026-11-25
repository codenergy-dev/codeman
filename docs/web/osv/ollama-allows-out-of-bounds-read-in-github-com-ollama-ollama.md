---
title: "Ollama Allows Out-of-Bounds Read in github.com/ollama/ollama"
url: https://osv.dev/vulnerability/GO-2025-3558
created_at: 2026-10-30T17:40:00-03:00
updated_at: 2026-10-30T17:40:00-03:00
tool: docs/web/tools/osv-dev.md
---

# Ollama Allows Out-of-Bounds Read in github.com/ollama/ollama

OSV.dev's record GO-2025-3558, from the Go vulnerability database, and its alias GHSA-89qx-m49c-8crf, from GitHub's advisory database, read from `GET https://api.osv.dev/v1/vulns/<id>` on 2026-10-30. A record's text belongs to the database that published it, so this page holds, in Codeman's words, only what Codeman relies on.

| Fact | GO-2025-3558 (Go) | GHSA-89qx-m49c-8crf (GitHub) | Field |
| --- | --- | --- | --- |
| Aliases | CVE-2024-12055, GHSA-89qx-m49c-8crf | CVE-2024-12055, GO-2025-3558 | `aliases` |
| Published | 2025-03-31 | 2025-03-20 | `published` |
| Versions of `github.com/ollama/ollama` | introduced 0: every version, no fix | introduced 0, last_affected 0.3.14 | `affected[].ranges` |
| Severity | None given | high | `database_specific.severity` |
| Weakness | None given | CWE-125 | `database_specific.cwe_ids` |

- **What** (GHSA-89qx-m49c-8crf's `details`, CVE-2024-12055): A crafted GGUF model file, uploaded and created on the server, makes it read out of bounds in `gguf.go` and crash: a denial of service.
- **For Ollama 0.35.1 to 0.40.13:** querying OSV.dev for `github.com/ollama/ollama` at 0.35.1, 0.40.10 or any release between them and up to 0.40.13 returns GO-2025-3558, since its range has no end; GitHub's record ends at 0.3.14.
