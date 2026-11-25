---
title: Trivy
url: https://trivy.dev
created_at: 2026-10-30T11:50:48-03:00
updated_at: 2026-10-30T11:50:48-03:00
---

# Trivy

How to record pages of Trivy's documentation, the vulnerability scanner of Aqua Security.

- **Source.** The site renders the Markdown files of the repository's `docs/` directory, by release. Fetch them raw at the release's tag, such as `https://raw.githubusercontent.com/aquasecurity/trivy/v0.76.0/docs/guide/configuration/db.md`. Since v0.76 the guide is under `docs/guide/`, not `docs/docs/`.
- **License.** The repository, [aquasecurity/trivy](https://github.com/aquasecurity/trivy), is under Apache-2.0, its documentation included: pages are copied in full, with `license: Apache-2.0`.
- **Title and URL.** The file's first heading, such as "Trivy Databases". The `url` is the raw file at its tag, so the copy names the version it describes.
- **Advisories.** The repository's security advisories, through `GET https://api.github.com/repos/aquasecurity/trivy/security-advisories` (see [GitHub security advisories](github-security-advisories.md)).

```sh
curl -fsS "https://raw.githubusercontent.com/aquasecurity/trivy/v0.76.0/docs/guide/configuration/db.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
