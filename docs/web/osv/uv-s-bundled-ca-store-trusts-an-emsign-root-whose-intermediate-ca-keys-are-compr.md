---
title: "uv's bundled CA store trusts an emSign root whose intermediate CA keys are compromised"
url: https://osv.dev/vulnerability/GHSA-hq85-5cpj-mr62
created_at: 2026-10-30T11:50:13-03:00
updated_at: 2026-10-30T11:50:13-03:00
tool: docs/web/tools/osv-dev.md
---

# uv's bundled CA store trusts an emSign root whose intermediate CA keys are compromised

GHSA-hq85-5cpj-mr62, alias PYSEC-2026-4321, as OSV.dev serves it (`GET /v1/vulns/GHSA-hq85-5cpj-mr62`). Published 2026-10-20T19:37:52Z, reviewed by GitHub, severity CRITICAL (`database_specific.severity`), CWE-295.

- **What:** uv checks TLS against a vendored copy of the `webpki-root-certs` bundle, which includes the `emSign ECC Root CA - G3` root. Eight eMudhra intermediate CAs under that root have compromised private keys and were revoked, so whoever holds one can issue certificates that uv accepts for any host, and intercept its connections (`details`).
- **Affected:** `uv` on PyPI from `introduced: "0"` to `fixed: "0.13.4"` (`affected[].ranges`).
- **Fix:** 0.13.4 removes the root, following `webpki-root-certs` 1.0.10 (`details`).
- **Related:** the same root in `certifi`, GHSA-6q48-6c7w-9gw2, fixed in 2026.10.18 (`references`).
