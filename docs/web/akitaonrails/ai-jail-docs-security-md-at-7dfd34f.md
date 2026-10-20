---
title: "ai-jail: docs/SECURITY.md at 7dfd34f"
url: https://github.com/akitaonrails/ai-jail/blob/7dfd34ff66b914a41b05f79b12b6b117d5ce9fe0/docs/SECURITY.md
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-repositories.md
---

# ai-jail: docs/SECURITY.md at 7dfd34f

The security model of `akitaonrails/ai-jail` at commit `7dfd34f` (v2.10.0). The repository is GPL-3.0-only and the file is about 50 KB, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Opening section.** ai-jail is "an accident guard, not a security boundary". Its threat model is a trusted agent's mistakes, not an adversary trying to break out; it tells users to run hostile code in a disposable VM.
- **"Platform notes and residual risks".** On Linux it combines bubblewrap's namespaces with Landlock, seccomp and resource limits, where the kernel has them. Seccomp denies raw and packet sockets. On kernels 6.12 and later, Landlock also scopes abstract Unix sockets and signals, best-effort.
- **Same section, the project's `.git`.** The writable project includes `.git/`. A program named in `.git/config`, such as `core.fsmonitor`, or a hook, runs outside the sandbox the next time git runs on the host.
- **Same section, masks.** `--mask` and `--deny-path` change only what the sandbox sees; a process outside the sandbox that acts for the agent still reads the real files.
