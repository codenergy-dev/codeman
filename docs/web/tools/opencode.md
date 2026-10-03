---
title: OpenCode
url: https://opencode.ai/docs
created_at: 2026-10-02T21:52:44-03:00
updated_at: 2026-10-02T21:52:44-03:00
---

# OpenCode

How to record pages of OpenCode's documentation, `opencode.ai/docs`.

- **Source.** Each page answers as Markdown with `.md` appended to its URL, such as `https://opencode.ai/docs/config.md`. The pages are built from `packages/web/src/content/docs/*.mdx` in [anomalyco/opencode](https://github.com/anomalyco/opencode).
- **License.** The repository, documentation included, is MIT. Pages are copied in full, with `license: MIT`.
- **Title.** The `title` in the front matter of the page's `.mdx` source, such as "Config". The `.md` answer starts after the title, so the copy puts it back as its first heading, then the answer as served.
- **Versions.** Pages describe the latest release, and options change between releases. The version the repository pins belongs where it documents its dependencies, not in the copy.

```sh
curl -fsS "https://opencode.ai/docs/config.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
