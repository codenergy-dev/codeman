---
title: Trivy ecosystem supply chain temporarily compromised
url: https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
created_at: 2026-10-30T11:51:44-03:00
updated_at: 2026-10-30T11:51:44-03:00
tool: docs/web/tools/github-security-advisories.md
---

# Trivy ecosystem supply chain temporarily compromised

Advisory GHSA-69fq-xp46-6x23 of `aquasecurity/trivy`, CVE-2026-33634, severity critical, published on 2026-03-21. An advisory's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

- **What happened.** With stolen credentials, an attacker published a malicious Trivy v0.69.4 release on 2026-03-19, force-pushed 76 of the 77 version tags of `aquasecurity/trivy-action` and all 7 of `aquasecurity/setup-trivy` to credential-stealing code, and on 2026-03-22 pushed malicious v0.69.5 and v0.69.6 images to Docker Hub ("Summary"). Each window lasted 3 to 12 hours ("Exposure Window").
- **Who was not affected.** Among others: images referenced by digest, binaries built from source, and v0.69.3 or older, which GitHub's immutable releases protect from v0.69.3 on ("Affected Components").
- **Versions.** Package `github.com/aquasecurity/trivy` at exactly 0.69.4; `trivy-action` before 0.35.0; `setup-trivy` before 0.2.6 (the advisory's vulnerable versions).
