---
title: "v1.22.0 source audit: five findings (worktree validation, TIOCSTI filter, lockdown downgrade, two macOS)"
url: https://github.com/akitaonrails/ai-jail/security/advisories/GHSA-w976-gw52-hvx2
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-security-advisories.md
---

# v1.22.0 source audit: five findings (worktree validation, TIOCSTI filter, lockdown downgrade, two macOS)

Advisory GHSA-w976-gw52-hvx2 of `akitaonrails/ai-jail`, no CVE, severity high, published on 2026-10-01. It names version 1.22.0 as affected and no patched version. An advisory's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **How it was produced.** A read-only, AI-assisted audit of the source at v1.22.0; nothing was built or run, so no finding is confirmed at runtime.
- **Finding 1, `--worktree`.** With `--worktree` on, the files that pick which host directory is bound read-write are files the agent can write inside the project. The agent can write them during one launch so that the next launch binds a directory such as the user's home read-write, which leads to code running outside the sandbox. Lockdown keeps the binding read-only.
- **Finding 2, TIOCSTI.** The seccomp rule meant to deny `TIOCSTI` compared 64 bits where the kernel reads 32, so a variant could pass when the sandbox shares the user's terminal.
- **Finding 3.** A project `.ai-jail` could clear a trusted lockdown by naming a browser as its command.
- **Findings 4 and 5.** macOS only.
