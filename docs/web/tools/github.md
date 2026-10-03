---
title: GitHub
url: https://docs.github.com
created_at: 2026-10-02T21:52:44-03:00
updated_at: 2026-10-02T21:52:44-03:00
---

# GitHub

How to record pages of GitHub's documentation, `docs.github.com`.

- **Source.** Each article answers as Markdown at `https://docs.github.com/api/article/body?pathname=<path>`, where `<path>` is the page's path with its language, such as `/en/rest/issues/labels`. REST reference pages include every endpoint, with parameters and example responses.
- **License.** The documentation is licensed CC BY 4.0, and its code samples MIT (`LICENSE` and `LICENSE-CODE` in [github/docs](https://github.com/github/docs)). Pages are copied in full, with `license: CC-BY-4.0`; the front matter's `url` is the attribution.
- **Title.** The article's first heading, such as "REST API endpoints for labels".
- **Size.** Some reference pages, such as GraphQL's list of mutations, are larger than a repository should hold. For those, record only what the repository relies on, in your own words, without `license`.
- **Versions.** Pages describe GitHub.com (the `fpt` version). Note in the page when the repository targets GitHub Enterprise Server, whose pages have their own paths.

```sh
curl -fsS "https://docs.github.com/api/article/body?pathname=/en/rest/issues/labels"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
