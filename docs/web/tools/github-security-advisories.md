---
title: GitHub security advisories
url: https://github.com
created_at: 2026-10-19T14:31:27-03:00
updated_at: 2026-10-19T14:31:27-03:00
---

# GitHub security advisories

How to record a security advisory that a public repository on GitHub published, such as one of `nektos/act`.

- **Source.** `https://api.github.com/repos/<owner>/<repo>/security-advisories` lists the repository's published advisories; `/security-advisories/<ghsa-id>` gives one, with its CVE, severity, dates, description, and the vulnerable and patched versions per package.
- **License.** An advisory's text belongs to its authors and has no license, so record it in your own words, without `license`: what is affected, which versions, and the fix. Note its dates: an advisory describes the versions it names.
- **Title and URL.** The advisory's summary, as `title`; its page as `url`, `https://github.com/<owner>/<repo>/security/advisories/<ghsa-id>`.

```sh
curl -fsS "https://api.github.com/repos/nektos/act/security-advisories" | jq '.[] | {ghsa_id, cve_id, severity, published_at, summary}'
curl -fsS "https://api.github.com/repos/nektos/act/security-advisories/GHSA-xmgr-9pqc-h5vw" | jq '{summary, description, vulnerabilities}'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3, for a page in your own words.
