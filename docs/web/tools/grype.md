---
title: Grype
url: https://oss.anchore.com/docs/guides/vulnerability/
created_at: 2026-10-30T11:50:48-03:00
updated_at: 2026-10-30T11:50:48-03:00
---

# Grype

How to record pages of Grype's documentation, the vulnerability scanner of Anchore.

- **Source.** The site `oss.anchore.com` has no Markdown answer (`.md`, `Accept: text/markdown` and `llms.txt` give HTML or 404). It is built from [anchore/oss-docs](https://github.com/anchore/oss-docs), whose `content/docs/` holds each page as Markdown with Hugo's TOML front matter (between `+++` lines) and shortcodes. Fetch the raw file at a commit, such as `https://raw.githubusercontent.com/anchore/oss-docs/<commit>/content/docs/guides/vulnerability/database.md`.
- **License.** anchore/oss-docs is under Apache-2.0: pages are copied in full, with `license: Apache-2.0`, from the first line after the front matter. Grype's own repository, [anchore/grype](https://github.com/anchore/grype), is Apache-2.0 too.
- **Title and URL.** The front matter's `title`, such as "Vulnerability Database". The `url` is the raw file at its commit.
- **Advisories.** `GET https://api.github.com/repos/anchore/grype/security-advisories` (see [GitHub security advisories](github-security-advisories.md)).

```sh
COMMIT=$(curl -fsS https://api.github.com/repos/anchore/oss-docs/commits/main | jq -r .sha)
curl -fsS "https://raw.githubusercontent.com/anchore/oss-docs/$COMMIT/content/docs/guides/vulnerability/database.md" \
  | awk 'n >= 2; /^\+\+\+$/ { n++ }'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
