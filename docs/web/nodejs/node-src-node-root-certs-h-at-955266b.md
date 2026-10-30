---
title: "node: src/node_root_certs.h at 955266b"
url: https://github.com/nodejs/node/blob/955266bfdd854cd280dffd47548673914484e4c0/src/node_root_certs.h
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-repositories.md
---

# node: src/node_root_certs.h at 955266b

The bundled root store of Node.js at the commit of the tag `v24.21.0`, in Codeman's words: the file is about 196 KB. Each root is a PEM string preceded by a `/* <name> */` comment.

- **Size:** 121 roots (`/*` comment lines).
- **emSign roots:** four, in this order: `emSign Root CA - G1`, `emSign ECC Root CA - G3`, `emSign Root CA - C1`, `emSign ECC Root CA - C3`.

`emSign ECC Root CA - G3` is the root that [GHSA-hq85-5cpj-mr62](../uv/removal-of-emsign-root-certificate.md) names. [The same file at `v24.22.1`](node-src-node-root-certs-h-at-ce7aaf1.md) no longer has it.
