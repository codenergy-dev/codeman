---
title: nodejs.org
url: https://nodejs.org
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:02:07-03:00
---

# nodejs.org

How to record pages of nodejs.org's blog, such as a security release announcement under `/en/blog/vulnerability/`. Node.js's own files (its API docs, its source, its releases) are files and releases of `nodejs/node`: record them as [GitHub repositories](github-repositories.md) and [GitHub releases](github-releases.md) say.

- **Source.** Each blog post is a Markdown file in [nodejs/nodejs.org](https://github.com/nodejs/nodejs.org), under `apps/site/pages/en/blog/<category>/<slug>.md`. Read it at a full commit SHA: the last commit that changed it, from `GET /repos/nodejs/nodejs.org/commits?path=<path>`.
- **License.** The repository is MIT. A post is copied in full, without the source's own front matter (`date`, `category`, `slug`, `layout`, `author`), with `license: MIT`; the `url` is the post on the site, `https://nodejs.org/en/blog/<category>/<slug>`.
- **Title.** The source's `title`, such as "Wednesday, October 21, 2026 Security Releases".
- **Versions.** A security post is updated after the releases, with CVE summaries and credits: note the commit it was read at and its `date`.

```sh
P=apps/site/pages/en/blog/vulnerability/october-2026-security-releases.md
SHA=$(curl -fsS "https://api.github.com/repos/nodejs/nodejs.org/commits?path=$P&per_page=1" | jq -r '.[0].sha')
curl -fsS "https://raw.githubusercontent.com/nodejs/nodejs.org/$SHA/$P" | awk 'NR == 1 && /^---$/ { skip = 1; next } skip && /^---$/ { skip = 0; next } !skip'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
