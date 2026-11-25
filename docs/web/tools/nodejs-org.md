---
title: nodejs.org
url: https://nodejs.org
created_at: 2026-10-30T16:02:07-03:00
updated_at: 2026-10-30T16:16:27-03:00
---

# nodejs.org

How to record pages of nodejs.org's blog, such as a security release announcement under `/en/blog/vulnerability/`, and how its download server serves a release's files. Node.js's own files (its API docs, its source, its releases) are files and releases of `nodejs/node`: record them as [GitHub repositories](github-repositories.md) and [GitHub releases](github-releases.md) say.

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

## The download server

A release's files are under `https://nodejs.org/dist/<version>/`: its tarballs and `SHASUMS256.txt`. The listing and the server's answers are data, not documentation: record them in your own words, without `license`.

- **Title and URL.** The listing's `<title>`, such as "Index of /dist/v24.22.1/", and the directory's URL, with its trailing slash.
- **Answers.** Record the status and headers of each file the repository downloads, asked as a client that cannot follow a redirect asks: HTTP/1.0 through `openssl s_client`. Note the date, and that a CDN's answers may change.
- **Digests.** Copy the lines of `SHASUMS256.txt` for the files the repository relies on, with a command.

```sh
V=v24.22.1 F=node-v24.22.1-linux-x64.tar.gz
printf 'HEAD /dist/%s/%s HTTP/1.0\r\nHost: nodejs.org\r\nConnection: close\r\n\r\n' "$V" "$F" |
  openssl s_client -quiet -verify_return_error -verify_hostname nodejs.org -servername nodejs.org -connect nodejs.org:443 2>/dev/null
curl -fsS "https://nodejs.org/dist/$V/SHASUMS256.txt" | grep -E "  $F\$"
```
