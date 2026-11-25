---
title: "httpx2: src/httpcore2/httpcore2/_ssl.py at d91c9f4"
url: https://github.com/pydantic/httpx2/blob/d91c9f4236523eb5978ca800944fa0078f17409f/src/httpcore2/httpcore2/_ssl.py
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# httpx2: src/httpcore2/httpcore2/_ssl.py at d91c9f4

The commit of the tag `v2.13.1`; `httpcore2` 2.13.1 is released from the same repository. In Codeman's words: the file is under BSD-3-Clause, which the tool does not copy in full.

`default_ssl_context`, the transport's context when it is given none, chooses as [`create_ssl_context`](httpx2-src-httpx2-httpx2-config-py-at-d91c9f4.md) does: `SSL_CERT_FILE` alone when set, then `SSL_CERT_DIR`, then `truststore`.
