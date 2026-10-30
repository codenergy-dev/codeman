---
title: "node: src/node_root_certs.h at ce7aaf1"
url: https://github.com/nodejs/node/blob/ce7aaf1cee78b8cf0ce17364260535c418d3ed26/src/node_root_certs.h
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-repositories.md
---

# node: src/node_root_certs.h at ce7aaf1

The bundled root store of Node.js at the commit of the tag `v24.22.1`, in Codeman's words: the file is over 30 KB.

- **Size:** 118 roots, three fewer than [at `v24.21.0`](node-src-node-root-certs-h-at-955266b.md).
- **emSign roots:** only `emSign Root CA - G1`. `emSign ECC Root CA - G3`, `emSign Root CA - C1` and `emSign ECC Root CA - C3` are gone, as [the NSS 3.131.1 update](crypto-update-root-certificates-to-nss-3-131-1.md) removed them.
- **Other tags:** the file at `v24.22.0` still has all four emSign roots; at `v24.22.2` it is as at `v24.22.1`.
