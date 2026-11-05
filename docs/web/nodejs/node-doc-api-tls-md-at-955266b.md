---
title: "node: doc/api/tls.md at 955266b"
url: https://github.com/nodejs/node/blob/955266bfdd854cd280dffd47548673914484e4c0/doc/api/tls.md
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-repositories.md
---

# node: doc/api/tls.md at 955266b

Node.js's TLS API docs at the commit of the tag `v24.21.0`, in Codeman's words: the file is about 100 KB. Only the default CA list is recorded.

- **`tls.getCACertificates([type])`**, added in v23.10.0 and v22.15.0: `"default"` is what TLS clients use by default, the bundled Mozilla store unless `--use-openssl-ca`, plus the system store with `--use-system-ca` and the file of `NODE_EXTRA_CA_CERTS`; `"bundled"` is the bundled store alone, the same as `tls.rootCertificates`; `"system"` and `"extra"` are the other two sources.
- **`tls.setDefaultCACertificates(certs)`**, added in v24.5.0: replaces the default CA list, PEM strings, for later TLS connections that set no `ca` of their own. It affects the current thread only, and not sessions the HTTPS agent already cached, so it must run before the first connection.
- **`tls.rootCertificates`:** the bundled store, fixed at release time.
