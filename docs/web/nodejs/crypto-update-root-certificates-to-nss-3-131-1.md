---
title: "crypto: update root certificates to NSS 3.131.1"
url: https://github.com/nodejs/node/pull/66877
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
tool: docs/web/tools/github-repositories.md
---

# crypto: update root certificates to NSS 3.131.1

Pull request nodejs/node#66877, in Codeman's words, read from `GET /repos/nodejs/node/pulls/66877` and its `/files`. Opened by `aduh95`, merged on 2026-10-20T16:57:04Z, labels `fast-track` among others.

- **Change:** `src/node_root_certs.h` and `tools/certdata.txt` follow NSS 3.131.1's `certdata.txt`; only deletions (51 lines of the header).
- **Roots removed:** `emSign ECC Root CA - G3`, `emSign Root CA - C1` and `emSign ECC Root CA - C3` (the description).
- **Why forced:** NSS 3.131.1 was not yet in a Firefox release, so the updater script was patched to take it (the description).
- **Released in:** 24.x as commit `2a73ee5a89`, in [v24.22.1](node-v24-22-1.md).
