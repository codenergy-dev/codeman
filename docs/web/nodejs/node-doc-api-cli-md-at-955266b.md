---
title: "node: doc/api/cli.md at 955266b"
url: https://github.com/nodejs/node/blob/955266bfdd854cd280dffd47548673914484e4c0/doc/api/cli.md
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-repositories.md
---

# node: doc/api/cli.md at 955266b

Node.js's command-line docs at the commit of the tag `v24.21.0`, in Codeman's words: the file is over 30 KB. Only the options that choose the CA store are recorded.

- **`--use-bundled-ca`, `--use-openssl-ca`:** use the bundled Mozilla store, a snapshot fixed at release time and the same on every platform, or OpenSSL's default store, which on Linux the distribution maintains. The default is chosen at build time; `SSL_CERT_DIR` and `SSL_CERT_FILE` move OpenSSL's store ("`--use-bundled-ca`, `--use-openssl-ca`").
- **`--use-system-ca`**, added in v23.8.0: trusts the system store in addition to the bundled store and `NODE_EXTRA_CA_CERTS`; on Linux it reads OpenSSL's directory and file ("`--use-system-ca`").
- **`NODE_EXTRA_CA_CERTS=file`:** adds the PEM certificates of `file` to the well-known roots, read once at start. Neither is used when a client sets `ca` itself ("`NODE_EXTRA_CA_CERTS=file`").

None of these removes a root from the bundled store: the bundled store is either used whole, or replaced by OpenSSL's.
