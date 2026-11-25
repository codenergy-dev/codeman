---
title: PyPI
url: https://docs.pypi.org
created_at: 2026-10-30T11:47:16-03:00
updated_at: 2026-10-30T11:47:16-03:00
---

# PyPI

How to record pages of PyPI's documentation, `docs.pypi.org`: its APIs (JSON, Index, Integrity) and how it works.

- **Source.** The pages are Markdown in [pypi/warehouse](https://github.com/pypi/warehouse), under `docs/user/`: the page `https://docs.pypi.org/api/json/` is `docs/user/api/json.md`. Read them at a full commit SHA, as [GitHub repositories](github-repositories.md) says. The site serves no Markdown of its own.
- **License.** The repository, documentation included, is Apache-2.0. Pages are copied in full, with `license: Apache-2.0`; the `url` is the page on `docs.pypi.org`.
- **Title.** The file's first heading, such as "JSON API".
- **Data.** A project's metadata from the APIs is data its maintainers wrote: `author` and `maintainer` are free text, and only an attestation's publisher is checked by PyPI. Record it in your own words, without `license`.

```sh
SHA=$(git ls-remote https://github.com/pypi/warehouse HEAD | cut -f1)
curl -fsS "https://raw.githubusercontent.com/pypi/warehouse/$SHA/docs/user/api/json.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
