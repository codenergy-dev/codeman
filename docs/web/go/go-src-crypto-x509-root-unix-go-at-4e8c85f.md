---
title: "go: src/crypto/x509/root_unix.go at 4e8c85f"
url: https://github.com/golang/go/blob/4e8c85f5319d999bfd7617fdc191631e5634e3c5/src/crypto/x509/root_unix.go
created_at: 2026-10-31T09:30:24-03:00
updated_at: 2026-10-31T09:30:24-03:00
tool: docs/web/tools/github-repositories.md
---

# go: src/crypto/x509/root_unix.go at 4e8c85f

The commit of the tag `go1.26.10`, the Go that built Ollama 0.40.10's binary (its `go1.26.10` build string). In Codeman's words: the file is under Go's BSD-3-Clause license, which the tool does not copy in full.

## How Go loads the system's roots on Linux

`loadSystemRoots`, used when a program verifies TLS with the system's pool, as `net/http` does by default:

- **File.** `SSL_CERT_FILE` (`certFileEnv`), when set and not empty, replaces the list of default files (`certFiles`, [root_linux.go](go-src-crypto-x509-root-linux-go-at-4e8c85f.md)). The first file that reads is used, and the others are skipped.
- **Directories.** `SSL_CERT_DIR` (`certDirEnv`), a colon-separated list, replaces the default directories (`certDirectories`). Every file in each directory is read and its PEM certificates are added, symlinks within the directory excepted (`readUniqueDirectoryEntries`).
- **Both.** The pool holds the file's certificates and the directories' together. Setting only `SSL_CERT_FILE` still adds every certificate of `/etc/ssl/certs`.
