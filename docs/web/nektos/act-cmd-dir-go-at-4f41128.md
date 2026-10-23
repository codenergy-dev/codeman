---
title: "act: cmd/dir.go at 4f41128"
url: https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/dir.go
created_at: 2026-10-23T16:01:13-03:00
updated_at: 2026-10-23T16:01:13-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# act: cmd/dir.go at 4f41128

```go
package cmd

import (
	"os"
	"path/filepath"

	log "github.com/sirupsen/logrus"
)

var (
	UserHomeDir  string
	CacheHomeDir string
)

func init() {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal(err)
	}
	UserHomeDir = home

	if v := os.Getenv("XDG_CACHE_HOME"); v != "" {
		CacheHomeDir = v
	} else {
		CacheHomeDir = filepath.Join(UserHomeDir, ".cache")
	}
}
```
