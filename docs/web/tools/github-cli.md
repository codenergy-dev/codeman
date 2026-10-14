---
title: GitHub CLI
url: https://cli.github.com/manual
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
---

# GitHub CLI

How to record pages of the GitHub CLI's manual, `cli.github.com/manual`.

- **Source.** Each command has a page at `https://cli.github.com/manual/<command>`, with underscores for spaces, such as `https://cli.github.com/manual/gh_secret_set`. The pages are HTML generated from each command's help text in [cli/cli](https://github.com/cli/cli); they have no Markdown source (`.md` answers 404). Record them in your own words, without `license`, naming the page's sections (the description before Options, Options, Examples, JSON Fields).
- **Version.** The manual describes the latest release, which it does not name. Note the release in the page (`https://api.github.com/repos/cli/cli/releases/latest`). When a fact comes from the code rather than the help text, cite the source file at that release's tag, such as `https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/secret/set/set.go`.
- **Title.** The command, such as "gh secret set".

```sh
URL=https://cli.github.com/manual/gh_secret_set
curl -fsSL "$URL" | python3 -I -c '
import sys, html.parser
class P(html.parser.HTMLParser):
    skip = False
    def handle_starttag(self, tag, attrs):
        self.skip = tag in ("script", "style")
    def handle_data(self, data):
        if not self.skip:
            print(data, end="")
P().feed(sys.stdin.read())' | sed -n '/^Options$/,/^See also$/p'
curl -fsS https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
