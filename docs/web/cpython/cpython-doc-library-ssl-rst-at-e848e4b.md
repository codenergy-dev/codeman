---
title: "cpython: Doc/library/ssl.rst at e848e4b"
url: https://github.com/python/cpython/blob/e848e4b09ca4bc67c0041c9ce7526dae471d4c36/Doc/library/ssl.rst
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# cpython: Doc/library/ssl.rst at e848e4b

The commit of the tag `v3.12.15`, the Python of vLLM 0.32.0's CPU image. The source of `docs.python.org/3.12/library/ssl.html`. What Codeman relies on, in its own words: the file is larger than the repository should hold (104 KB).

- **`create_default_context`** (section "Context creation"): with `cafile`, `capath` or `cadata`, it loads those CA certificates only; with none of them, it calls `SSLContext.load_default_certs`.
- **`SSLContext.load_default_certs`** (section "SSL Contexts"): on every system it calls `SSLContext.set_default_verify_paths`, which loads the default CA certificates of the OpenSSL library ([OpenSSL's page](../openssl/openssl-doc-man3-ssl-ctx-load-verify-locations-pod-at-45e844f.md)).
- **`get_default_verify_paths`** (section "Certificate handling"): names OpenSSL's default file and directory and the variables that replace them, `openssl_cafile_env` and `openssl_capath_env`. In vLLM 0.32.0's CPU image they are `SSL_CERT_FILE` and `SSL_CERT_DIR`, for `/etc/ssl/cert.pem` and `/etc/ssl/certs`.
