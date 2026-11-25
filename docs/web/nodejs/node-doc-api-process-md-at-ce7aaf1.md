---
title: "node: doc/api/process.md at ce7aaf1"
url: https://github.com/nodejs/node/blob/ce7aaf1cee78b8cf0ce17364260535c418d3ed26/doc/api/process.md
created_at: 2026-10-30T16:28:05-03:00
updated_at: 2026-10-30T16:28:05-03:00
tool: docs/web/tools/github-repositories.md
---

# node: doc/api/process.md at ce7aaf1

Node.js's `process` docs at the commit of the tag `v24.22.1`, in Codeman's words: the file is over 30 KB (134,429 bytes). Only `process.execve` is recorded.

## `process.execve(file[, args[, env]])`

- **Added** in v23.11.0 and v22.15.0, and still "Stability: 1 - Experimental".
- **Arguments.** `file`, the name or path of the executable to run; `args`, a list of strings; `env`, the environment, `process.env` by default. No argument, key or value may contain a null byte.
- **What it does.** It replaces the current process with a new one through the POSIX `execve` function. Only standard input, output and error are kept; every other resource is discarded, without `exit` or `close` events and without cleanup handlers.
- **Return.** It never returns, unless an error occurred.
- **Platforms.** Not available on Windows or IBM i.
