---
title: "curl: docs/cmdline-opts/cacert.d at 7161cb1"
url: https://github.com/curl/curl/blob/7161cb17c01dcff1dc5bf89a18437d9d729f1ecd/docs/cmdline-opts/cacert.d
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# curl: docs/cmdline-opts/cacert.d at 7161cb1

The commit of the tag `curl-8_5_0`, Ubuntu 24.04's curl, the source of `--cacert` in curl's manual. In Codeman's words: the file is under the curl license, which the tool does not copy in full.

- `--cacert <file>` gives the CA certificates to verify the peer with, in PEM. It replaces the default file curl was built with.
- The curl tool reads `CURL_CA_BUNDLE` as that file when `--cacert` is not given.
- It says nothing of the default directory, which [`--capath`](curl-docs-cmdline-opts-capath-d-at-7161cb1.md) sets.
