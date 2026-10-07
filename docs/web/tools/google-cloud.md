---
title: Google Cloud
url: https://docs.cloud.google.com
created_at: 2026-10-07T15:13:26-03:00
updated_at: 2026-10-07T15:13:26-03:00
---

# Google Cloud

How to record pages of Google Cloud's documentation, `docs.cloud.google.com` (`cloud.google.com/...` redirects there).

- **Source.** Each page answers as Markdown with `.md.txt` appended to its URL, such as `https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token.md.txt`. REST reference pages render each method's request, response and fields as tables.
- **License.** Each page's footer says that, except as otherwise noted, its content is licensed under the Creative Commons Attribution 4.0 License, and code samples under the Apache 2.0 License. The Markdown source has no footer: check the HTML page for that sentence before copying. Pages that carry it are copied in full, with `license: CC-BY-4.0`; the front matter's `url` is the attribution.
- **Title.** The HTML page's `<title>`, before the first `|`, such as "Method: token". Quote it in the front matter when it holds a colon. When the source does not start with that heading, add it as the page's first line.

```sh
URL=https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
curl -fsSL "$URL" | grep -o '<title>[^<]*'
curl -fsSL "$URL" | grep -c 'creativecommons.org/licenses/by/4.0/'
curl -fsSL "$URL.md.txt"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
