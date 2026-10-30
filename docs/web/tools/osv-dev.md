---
title: OSV.dev
url: https://osv.dev
created_at: 2026-10-30T11:47:16-03:00
updated_at: 2026-10-30T11:47:16-03:00
---

# OSV.dev

How to record pages of OSV.dev's documentation (its API, `google.github.io/osv.dev`), of the OSV schema (`ossf.github.io/osv-schema`), and the vulnerability records OSV.dev serves.

- **Source.** The API's pages are Markdown in [google/osv.dev](https://github.com/google/osv.dev), under `docs/api/`; the schema is `docs/schema.md` in [ossf/osv-schema](https://github.com/ossf/osv-schema). Read both at a full commit SHA, as [GitHub repositories](github-repositories.md) says. A record is `https://api.osv.dev/v1/vulns/<id>`.
- **License.** Both repositories are Apache-2.0. A page is copied in full, without the source's own front matter (`layout`, `permalink`), with `license: Apache-2.0`; the `url` is the page on the published site. A file over roughly 30 KB, such as the schema, is recorded in your own words. A vulnerability record comes from the database that published it (GitHub's, PyPI's, Go's), under that database's terms: record it in your own words, without `license`.
- **Title.** The source's `title`, such as "POST /v1/querybatch"; for a record, its `summary`.
- **Versions.** The API is not versioned beyond `/v1`; note the commit the page was read at.

```sh
SHA=$(git ls-remote https://github.com/google/osv.dev HEAD | cut -f1)
curl -fsS "https://raw.githubusercontent.com/google/osv.dev/$SHA/docs/api/post-v1-querybatch.md" | awk 'NR == 1 && /^---$/ { skip = 1; next } skip && /^---$/ { skip = 0; next } !skip'
curl -fsS https://api.osv.dev/v1/vulns/GHSA-hq85-5cpj-mr62 | jq '{summary, published, aliases, database_specific, affected}'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
