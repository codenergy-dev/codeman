---
title: "act: pkg/gh/gh.go at 4f41128"
url: https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/gh/gh.go
created_at: 2026-10-20T12:35:32-03:00
updated_at: 2026-10-20T12:35:32-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# act: pkg/gh/gh.go at 4f41128

```go
package gh

import (
	"bufio"
	"bytes"
	"context"
	"os/exec"
)

func GetToken(ctx context.Context, workingDirectory string) (string, error) {
	var token string

	// Locate the 'gh' executable
	path, err := exec.LookPath("gh")
	if err != nil {
		return "", err
	}

	// Command setup
	cmd := exec.CommandContext(ctx, path, "auth", "token")
	cmd.Dir = workingDirectory

	// Capture the output
	var out bytes.Buffer
	cmd.Stdout = &out

	// Run the command
	err = cmd.Run()
	if err != nil {
		return "", err
	}

	// Read the first line of the output
	scanner := bufio.NewScanner(&out)
	if scanner.Scan() {
		token = scanner.Text()
	}

	return token, nil
}
```
