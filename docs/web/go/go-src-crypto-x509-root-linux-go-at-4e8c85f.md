---
title: "go: src/crypto/x509/root_linux.go at 4e8c85f"
url: https://github.com/golang/go/blob/4e8c85f5319d999bfd7617fdc191631e5634e3c5/src/crypto/x509/root_linux.go
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# go: src/crypto/x509/root_linux.go at 4e8c85f

The commit of the tag `go1.26.10`. In Codeman's words: the file is under Go's BSD-3-Clause license, which the tool does not copy in full.

- **`certFiles`:** the default files, of which [`loadSystemRoots`](go-src-crypto-x509-root-unix-go-at-4e8c85f.md) reads the first that exists. `/etc/ssl/certs/ca-certificates.crt` (Debian and Ubuntu) comes first.
- **`certDirectories`:** the default directories, all of which are read: `/etc/ssl/certs` and `/etc/pki/tls/certs`.
