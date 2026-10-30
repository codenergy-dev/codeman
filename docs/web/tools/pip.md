---
title: pip
url: https://pip.pypa.io
created_at: 2026-10-30T11:40:01-03:00
updated_at: 2026-10-30T11:40:01-03:00
---

# pip

How to record pages of pip's documentation, `pip.pypa.io`.

- **Version.** Record pages at the tag of the pip the repository runs, such as the one a Python build bundles (`ensurepip`): `25.0.1`. Find it in a virtual environment's `site-packages` (`pip-<version>.dist-info`).
- **Source.** The site is built from `docs/html/` in [pypa/pip](https://github.com/pypa/pip); its pages do not answer as Markdown. Take the raw file at the tag: `https://raw.githubusercontent.com/pypa/pip/<tag>/docs/html/<path>.md`, such as `25.0.1/docs/html/topics/secure-installs.md`. The site serves only `stable` and `latest`, so the `url` is the file on GitHub at the tag, `https://github.com/pypa/pip/blob/<tag>/docs/html/<path>.md`. The title is the file's first heading.
- **License.** The repository, documentation included, is MIT (`LICENSE.txt`). Check that the tag's still says so, then copy pages in full, with `license: MIT`.

```sh
TAG=25.0.1
curl -fsS "https://raw.githubusercontent.com/pypa/pip/$TAG/LICENSE.txt" | head -3
curl -fsS "https://raw.githubusercontent.com/pypa/pip/$TAG/docs/html/topics/secure-installs.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
