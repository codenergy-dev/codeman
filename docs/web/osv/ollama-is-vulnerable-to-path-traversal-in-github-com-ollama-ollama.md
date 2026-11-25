---
title: "Ollama is Vulnerable to Path Traversal in github.com/ollama/ollama"
url: https://osv.dev/vulnerability/GO-2026-5750
created_at: 2026-10-30T17:40:00-03:00
updated_at: 2026-10-30T17:40:00-03:00
tool: docs/web/tools/osv-dev.md
---

# Ollama is Vulnerable to Path Traversal in github.com/ollama/ollama

OSV.dev's record GO-2026-5750, from the Go vulnerability database, and its alias GHSA-x99g-8v8j-25j2, from GitHub's advisory database, read from `GET https://api.osv.dev/v1/vulns/<id>` on 2026-10-30. A record's text belongs to the database that published it, so this page holds, in Codeman's words, only what Codeman relies on.

| Fact | GO-2026-5750 (Go) | GHSA-x99g-8v8j-25j2 (GitHub) | Field |
| --- | --- | --- | --- |
| Aliases | CVE-2026-7020, GHSA-x99g-8v8j-25j2 | CVE-2026-7020, GO-2026-5750 | `aliases` |
| Published | 2026-07-27 | 2026-04-26 | `published` |
| Versions of `github.com/ollama/ollama` | introduced 0: every version, no fix | introduced 0, last_affected 0.20.2 | `affected[].ranges` |
| Severity | None given | low | `database_specific.severity` |
| Weakness | None given | CWE-22 | `database_specific.cwe_ids` |

- **What** (GHSA-x99g-8v8j-25j2's `details`, CVE-2026-7020): `digestToPath` in `x/imagegen/transfer/transfer.go`, the transfer of image generation (tensor) models, takes a digest that can traverse paths. Remote, of high complexity; a public exploit exists.
- **For Ollama 0.35.1 to 0.40.13:** querying OSV.dev for `github.com/ollama/ollama` at 0.35.1, 0.40.10 or any release between them and up to 0.40.13 returns GO-2026-5750, since its range has no end; GitHub's record ends at 0.20.2.
