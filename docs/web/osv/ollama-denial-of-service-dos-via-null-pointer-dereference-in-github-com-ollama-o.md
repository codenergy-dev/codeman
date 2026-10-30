---
title: "Ollama Denial of Service (DoS) via Null Pointer Dereference in github.com/ollama/ollama"
url: https://osv.dev/vulnerability/GO-2025-3582
created_at: 2026-10-30T17:40:00-03:00
updated_at: 2026-10-30T17:40:00-03:00
tool: docs/web/tools/osv.md
---

# Ollama Denial of Service (DoS) via Null Pointer Dereference in github.com/ollama/ollama

OSV.dev's record GO-2025-3582, from the Go vulnerability database, and its alias GHSA-p2wh-w96x-w232, from GitHub's advisory database, read from `GET https://api.osv.dev/v1/vulns/<id>` on 2026-10-30. A record's text belongs to the database that published it, so this page holds, in Codeman's words, only what Codeman relies on.

| Fact | GO-2025-3582 (Go) | GHSA-p2wh-w96x-w232 (GitHub) | Field |
| --- | --- | --- | --- |
| Aliases | CVE-2025-0312, GHSA-p2wh-w96x-w232 | CVE-2025-0312, GO-2025-3582 | `aliases` |
| Published | 2025-04-01 | 2025-03-20 | `published` |
| Versions of `github.com/ollama/ollama` | introduced 0: every version, no fix | introduced 0, last_affected 0.3.14 | `affected[].ranges` |
| Severity | None given | high | `database_specific.severity` |
| Weakness | None given | CWE-476 | `database_specific.cwe_ids` |

- **What** (GHSA-p2wh-w96x-w232's `details`, CVE-2025-0312): A crafted GGUF model file, uploaded and created on the server, dereferences a null pointer and crashes it: a denial of service.
- **For Ollama 0.35.1:** querying OSV.dev for `github.com/ollama/ollama` at 0.35.1, and at every release up to 0.40.13, returns GO-2025-3582, since its range has no end; GitHub's record ends at 0.3.14.
