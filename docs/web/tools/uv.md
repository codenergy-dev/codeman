---
title: uv
url: https://docs.astral.sh/uv
created_at: 2026-10-30T11:47:16-03:00
updated_at: 2026-10-30T11:47:16-03:00
---

# uv

How to record pages of uv's documentation, `docs.astral.sh/uv`, Astral's Python package manager.

- **Source.** The pages are Markdown in [astral-sh/uv](https://github.com/astral-sh/uv), under `docs/`: the page `https://docs.astral.sh/uv/pip/compile/` is `docs/pip/compile.md`. The site describes the latest release, and the site also answers with Markdown at `<page>/index.md`; read the file at the commit of the release you use instead, from `git ls-remote https://github.com/astral-sh/uv refs/tags/<version>`.
- **License.** The repository is `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`). Pages are copied in full, with `license: MIT OR Apache-2.0`; the `url` is the page on the site. A file over roughly 30 KB is recorded in your own words, as [GitHub repositories](github-repositories.md) says.
- **Title.** The file's first heading, such as "Locking environments".
- **Versions.** Options change between releases: note the version in the page's first lines, and the release itself with [GitHub releases](github-releases.md).

```sh
SHA=$(git ls-remote https://github.com/astral-sh/uv refs/tags/0.13.4 | cut -f1)
curl -fsS "https://raw.githubusercontent.com/astral-sh/uv/$SHA/docs/pip/compile.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
