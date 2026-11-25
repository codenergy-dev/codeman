---
title: "requests: src/requests/certs.py at 6e83187"
url: https://github.com/psf/requests/blob/6e83187b8feb273ed4c6cdab5efd8d54901dfab3/src/requests/certs.py
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
license: Apache-2.0
---

# requests: src/requests/certs.py at 6e83187

The commit of the tag `v2.34.2`, the `requests` in vLLM 0.32.0's images. Its default CA bundle is `certifi`'s; [`sessions.py`](requests-src-requests-sessions-py-at-6e83187.md) replaces it from the environment.

```python
#!/usr/bin/env python

"""
requests.certs
~~~~~~~~~~~~~~

This module returns the preferred default CA certificate bundle. There is
only one — the one from the certifi package.

If you are packaging Requests, e.g., for a Linux distribution or a managed
environment, you can change the definition of where() to return a separately
packaged CA bundle.
"""

from certifi import where

if __name__ == "__main__":
    print(where())
```
