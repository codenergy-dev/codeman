---
title: "::set-env:: and ::add-path:: Workflow Commands Unconditionally Processed"
url: https://github.com/nektos/act/security/advisories/GHSA-xmgr-9pqc-h5vw
created_at: 2026-10-19T14:32:43-03:00
updated_at: 2026-10-19T14:32:43-03:00
tool: docs/web/tools/github-security-advisories.md
---

# ::set-env:: and ::add-path:: Workflow Commands Unconditionally Processed

Advisory GHSA-xmgr-9pqc-h5vw of `nektos/act`, CVE-2026-34041, severity high, published on 2026-03-25. An advisory's text has no license, so this page holds, in Codeman's words, only what Codeman relies on.

## Summary and vulnerable code

- act processes the `::set-env::` and `::add-path::` workflow commands from any step's standard output. GitHub Actions disabled both in October 2020, unless a workflow sets `ACTIONS_ALLOW_UNSECURE_COMMANDS=true`.
- So a step that prints untrusted text, such as a pull request's title, lets that text set any environment variable (`NODE_OPTIONS`, `LD_PRELOAD`) or prepend a directory to the `PATH` of every later step of the job. On GitHub, the same workflow is not affected.

## Affected versions

`github.com/nektos/act` up to 0.2.85; fixed in 0.2.86 (the advisory's package list).
