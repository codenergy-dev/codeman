---
title: "curl: docs/cmdline-opts/capath.d at 7161cb1"
url: https://github.com/curl/curl/blob/7161cb17c01dcff1dc5bf89a18437d9d729f1ecd/docs/cmdline-opts/capath.d
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# curl: docs/cmdline-opts/capath.d at 7161cb1

The commit of the tag `curl-8_5_0`, the source of `--capath` in curl's manual. In Codeman's words: the file is under the curl license, which the tool does not copy in full.

- `--capath <dir>` gives a directory of CA certificates, or several separated by `:`. Built with OpenSSL, curl needs it processed by `c_rehash`.
- When it is set, curl ignores its default directory. Otherwise that default stays in use beside the file of [`--cacert`](curl-docs-cmdline-opts-cacert-d-at-7161cb1.md) or `CURL_CA_BUNDLE`.
