---
title: Dockerfile reference
url: https://docs.docker.com/reference/dockerfile/
created_at: 2026-10-20T12:40:33-03:00
updated_at: 2026-10-20T12:40:33-03:00
tool: docs/web/tools/fetch-markdown.md
---

# Dockerfile reference

What the repository relies on, in its own words: the page's Markdown source (`https://docs.docker.com/reference/dockerfile.md`) is larger than the repository should hold (122 KB). Each fact names the section it comes from.

## ADD --checksum ("ADD --checksum", and the options table of "ADD")

- `ADD --checksum=<hash> <src> ... <dir>` verifies a remote Git or HTTP source before adding it.
- For an HTTP source, the hash is the content's SHA-256, written `sha256:<hash>`. SHA-256 is the only algorithm it takes.
- For a Git source, it is the commit SHA, in full or a prefix of it.
- The option needs Dockerfile syntax 1.6 or newer.
