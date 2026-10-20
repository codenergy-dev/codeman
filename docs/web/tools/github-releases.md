---
title: GitHub releases
url: https://github.com
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
---

# GitHub releases

How to record a release of a public repository on GitHub, with its downloadable files and their checksums, and the repository's own facts: license, age, stars and activity, as an audit needs them.

- **Source.** `https://api.github.com/repos/<owner>/<repo>/releases/tags/<tag>` gives a release: its date, and per asset its name, size, `browser_download_url` and `digest` (a SHA-256 GitHub computed on upload). `https://api.github.com/repos/<owner>/<repo>` gives the repository's license, creation date, last push, stars and whether it is archived; `/contributors` gives commit counts per account.
- **Check.** Download each asset you rely on into its own scratch directory and compare its SHA-256 with the asset's `digest` and with any checksum file the release ships. A checksum from the same release proves integrity, not who built the file.
- **License.** API responses are data, and release notes belong to their authors. Record them in your own words, without `license`: the facts the repository relies on, each naming the API field it comes from.
- **Title and URL.** The repository's name and the tag, such as "ai-jail v2.10.0"; the release's page as `url`, `https://github.com/<owner>/<repo>/releases/tag/<tag>`.

```sh
REPO=akitaonrails/ai-jail TAG=v2.10.0
curl -fsS "https://api.github.com/repos/$REPO/releases/tags/$TAG" | jq '{published_at, assets: [.assets[] | {name, size, digest}]}'
curl -fsS "https://api.github.com/repos/$REPO" | jq '{license: .license.spdx_id, created_at, pushed_at, stargazers_count, archived}'
mkdir -p dl && curl -fsSL -o dl/asset.tar.gz "https://github.com/$REPO/releases/download/$TAG/<asset>" && shasum -a 256 dl/asset.tar.gz
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3, for a page in your own words.
