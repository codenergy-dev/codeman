---
title: "requests: src/requests/sessions.py at 6e83187"
url: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/sessions.py
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# requests: src/requests/sessions.py at 6e83187

The commit of the tag `v2.34.2`, the `requests` in vLLM 0.32.0's images. What Codeman relies on, in its own words: the file is larger than the repository should hold (34 KB).

## The CA bundle from the environment

`Session.merge_environment_settings`, which every request of a session goes through:

- With `trust_env` (`True` by default, set in `Session.__init__`) and `verify` `True` or unset, `verify` becomes `REQUESTS_CA_BUNDLE`, else `CURL_CA_BUNDLE`, else stays `True`.
- `verify=True` means the default bundle, `certifi`'s ([`certs.py`](requests-src-requests-certs-py-at-6e83187.md)).
- `SSL_CERT_FILE` and `SSL_CERT_DIR` are not read.
