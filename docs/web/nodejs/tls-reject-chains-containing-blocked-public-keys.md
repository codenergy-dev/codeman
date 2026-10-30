---
title: "tls: reject chains containing blocked public keys"
url: https://github.com/nodejs/node/pull/66871
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-repositories.md
---

# tls: reject chains containing blocked public keys

Pull request nodejs/node#66871, in Codeman's words, read from `GET /repos/nodejs/node/pulls/66871` and its `/files`. Opened by `UlisesGascon`, merged on 2026-10-20T16:43:43Z.

- **Why:** Node.js has no CRLSet or OneCRL and no online revocation check by default, so a chain through a compromised intermediate verifies as long as it reaches a trusted root; removing the roots alone would over-block (the description).
- **Change:** a compiled-in blocklist of SubjectPublicKeyInfo SHA-256 hashes, checked by a verify callback on every `SSL_CTX` Node.js creates (`SecureContext`, QUIC, DTLS). A hit fails as `X509_V_ERR_CERT_REVOKED`, and honours `rejectUnauthorized` (the description; `src/crypto/crypto_context.cc`).
- **Entries:** the eight eMudhra/emSign intermediates reported compromised in October 2026, the same hashes as Go's and Electron's fixes (the description).
- **Limitation:** TLS sessions resumed from before the upgrade are not verified again, until they time out ("Known limitation").
- **Released in:** 24.x as commit `01acf0ee74`, in [v24.22.1](node-v24-22-1.md).

The check is on the chain, not on the store, so it should also hold with `--use-system-ca` or `NODE_EXTRA_CA_CERTS`: Codeman's reading of the description, not tested.
