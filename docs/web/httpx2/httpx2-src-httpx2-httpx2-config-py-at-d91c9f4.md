---
title: "httpx2: src/httpx2/httpx2/_config.py at d91c9f4"
url: https://github.com/pydantic/httpx2/blob/d91c9f4236523eb5978ca800944fa0078f17409f/src/httpx2/httpx2/_config.py
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# httpx2: src/httpx2/httpx2/_config.py at d91c9f4

The commit of the tag `v2.13.1`, the `httpx2` in vLLM 0.32.0's images, which `huggingface_hub` 2.2.0 requires (`httpx2<3,>=2.0.0`) in place of `httpx`. In Codeman's words: the file is under BSD-3-Clause, which the tool does not copy in full.

## The client's CA certificates

`create_ssl_context`, with its defaults (`verify=True`, `trust_env=True`), which a client made with neither argument uses:

1. `SSL_CERT_FILE`, when set and not empty: `ssl.create_default_context(cafile=...)`, that file alone.
2. Otherwise `SSL_CERT_DIR`, when set and not empty: `ssl.create_default_context(capath=...)`.
3. Otherwise the system's store through `truststore` (`truststore.SSLContext`).

None of them uses `certifi`, which `httpx` 0.28's default was.
