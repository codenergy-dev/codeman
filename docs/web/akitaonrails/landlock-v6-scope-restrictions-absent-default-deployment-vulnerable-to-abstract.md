---
title: "Landlock V6 scope restrictions absent — default deployment  vulnerable to abstract Unix socket escape (GHSA-27vp-2mmc-vmh3  attack class)"
url: https://github.com/akitaonrails/ai-jail/security/advisories/GHSA-frgp-q3qc-g78p
created_at: 2026-10-19T21:08:44-03:00
updated_at: 2026-10-19T21:08:44-03:00
tool: docs/web/tools/github-security-advisories.md
---

# Landlock V6 scope restrictions absent — default deployment vulnerable to abstract Unix socket escape (GHSA-27vp-2mmc-vmh3 attack class)

Advisory GHSA-frgp-q3qc-g78p of `akitaonrails/ai-jail`, no CVE, severity medium, published on 2026-10-01. It names versions up to 1.4.3 as affected and no patched version. An advisory's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## What Codeman relies on

- **Summary.** In ai-jail's default invocation of 1.4.3, a sandboxed process could reach the host's X11 server through its abstract Unix socket, and run code outside the sandbox with `systemd-run --user` over the user bus at `/run/user/<uid>/bus`. Both were confirmed on Fedora 43.
- **Details.** Abstract Unix sockets belong to the network namespace, not to the file system: a sandbox that shares the host's network sees the host's abstract sockets, whatever its mounts. Landlock's ABI 6 scopes (`LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET`, `LANDLOCK_SCOPE_SIGNAL`) were not applied.
- **PoC, step 3.** Without `--unshare-net`, the sandbox's `/proc/net/unix` lists the same abstract sockets as the host.
