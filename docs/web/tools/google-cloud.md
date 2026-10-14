---
title: Google Cloud
url: https://docs.cloud.google.com
created_at: 2026-10-07T15:13:26-03:00
updated_at: 2026-10-14T18:04:35-03:00
---

# Google Cloud

How to record pages of Google Cloud's documentation, `docs.cloud.google.com` (`cloud.google.com/...` redirects there).

- **Source.** Each page answers as Markdown with `.md.txt` appended to its URL, such as `https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token.md.txt`. REST reference pages render each method's request, response and fields as tables.
- **License.** Each page's footer says that, except as otherwise noted, its content is licensed under the Creative Commons Attribution 4.0 License, and code samples under the Apache 2.0 License. The Markdown source has no footer: check the HTML page for that sentence before copying. Pages that carry it are copied in full, with `license: CC-BY-4.0`; the front matter's `url` is the attribution.
- **Title.** The HTML page's `<title>`, before the first `|`, such as "Method: token". Quote it in the front matter when it holds a colon. When the source does not start with that heading, add it as the page's first line.
- **`gcloud` reference.** The pages of `gcloud` commands, under `/sdk/gcloud/reference/`, such as `https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/update-oidc`, have no Markdown source (`.md.txt` answers 404). Record them in your own words, without `license`, naming the page's sections (NAME, SYNOPSIS, DESCRIPTION, EXAMPLES, FLAGS and the like); copy the synopsis with a command that prints the page's text, such as the one below. Their title is the command, such as "gcloud iam workload-identity-pools providers update-oidc".

```sh
URL=https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
curl -fsSL "$URL" | grep -o '<title>[^<]*'
curl -fsSL "$URL" | grep -c 'creativecommons.org/licenses/by/4.0/'
curl -fsSL "$URL.md.txt"
```

For a `gcloud` reference page, print the text of its sections, from NAME to the list of flags every command takes, then write the page in your own words:

```sh
URL=https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/update-oidc
curl -fsSL "$URL" | python3 -I -c '
import sys, html.parser
class P(html.parser.HTMLParser):
    skip = False
    def handle_starttag(self, tag, attrs):
        self.skip = tag in ("script", "style")
    def handle_data(self, data):
        if not self.skip:
            print(data, end="")
P().feed(sys.stdin.read())' | sed -n '/^NAME$/,/^GCLOUD WIDE FLAGS$/p'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
