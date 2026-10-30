---
title: Removal of emSign root certificate
url: https://github.com/astral-sh/uv/security/advisories/GHSA-hq85-5cpj-mr62
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-security-advisories.md
---

# Removal of emSign root certificate

`astral-sh/uv`'s own advisory GHSA-hq85-5cpj-mr62, read from `GET /repos/astral-sh/uv/security-advisories/GHSA-hq85-5cpj-mr62`. Published 2026-10-20T16:48:48Z, severity `high` here (OSV.dev's copy says CRITICAL: [its record](https://osv.dev/vulnerability/GHSA-hq85-5cpj-mr62)), no CVE.

- **What happened:** intermediate CA certificates issued by the `emSign ECC Root CA - G3` root have compromised keys; connections that chain through them are insecure ("Summary", "Details").
- **Scope:** the advisory calls it an ecosystem-wide incident: any software that vendors a CA bundle, such as `certifi` or `webpki-root-certs`, must be upgraded or checked ("Summary").
- **Fix:** uv 0.13.4 removes the root from its vendored bundle, following `webpki-root-certs` (`vulnerabilities`: `<0.13.4` vulnerable, `>=0.13.4` patched).
- **Workaround:** instead of upgrading, use the system's store (`--system-certs`) or a custom bundle (`SSL_CERT_FILE`, `SSL_CERT_DIR`), after checking it holds neither the root nor its compromised intermediates ("Summary", "Details").
- **Impact:** a compromised CA key can issue certificates that enable machine-in-the-middle attacks ("Impact").
