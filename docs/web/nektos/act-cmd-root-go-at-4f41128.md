---
title: "act: cmd/root.go at 4f41128"
url: https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/root.go
created_at: 2026-10-20T12:35:32-03:00
updated_at: 2026-10-23T16:01:45-03:00
tool: docs/web/tools/github-repositories.md
---

# act: cmd/root.go at 4f41128

Commit `4f41128` is the one tag `v0.2.89` points at. The file is over 30 KB, so this page holds, in Codeman's words, only what Codeman relies on, each fact naming its function or flag.

## Flags

- **`--env`** (repeatable) gives the jobs' environment; **`--secret`** (`-s`) the `secrets` context; **`--var`** the `vars` context.
- **`--env-file`**, **`--secret-file`** and **`--var-file`** default to `.env`, `.secrets` and `.vars`, resolved against act's working directory.

## How they are read (`newRunCommand`)

1. The `--env` values are parsed first. The env file is then read, and adds only the names `--env` did not give.
2. Secrets are read the same way, and their names are upper-cased (`newSecrets` in `secrets.go`).
3. When no `GITHUB_TOKEN` secret was given, act sets it to what `gh.GetToken` returns: the token of the host's GitHub CLI, from `gh auth token` ([act: pkg/gh/gh.go](act-pkg-gh-gh-go-at-4f41128.md)).

## Configuration, servers and caches

- **`configLocations`.** act reads more arguments from `act/actrc` in the XDG configuration directory, from `.actrc` in the home directory, and from `.actrc` in its working directory.
- **`newRunCommand`.** With no `--platform` (`-P`) and none of those files, act asks which default image to use (`defaultImageSurvey`); with `--platform` it asks nothing.
- **`readEnvsEx`.** An env, secret or variable file whose extension is `.yml` or `.yaml` is read as YAML, a map of strings; any other file as a dotenv file.
- **Flags.** `--artifact-server-addr` and `--cache-server-addr` default to the host's outbound (LAN) address. `--action-cache-path` defaults to `act` under the cache directory (`XDG_CACHE_HOME`, else `~/.cache`, in `dir.go`). `--action-offline-mode` also turns off `--pull`.
- **`newRunCommand`.** `artifacts.Serve` starts no artifact server when `--artifact-server-path` is empty. The cache server starts unless `--no-cache-server` is given or the env sets `ACTIONS_CACHE_URL`.
