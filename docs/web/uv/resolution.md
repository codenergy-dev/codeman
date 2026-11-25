---
title: Resolution
url: https://docs.astral.sh/uv/concepts/resolution/
created_at: 2026-10-30T11:49:09-03:00
updated_at: 2026-10-30T11:49:09-03:00
tool: docs/web/tools/uv.md
---

# Resolution

uv's page on resolution, read at the tag `0.13.4` (commit `7456b60`, `docs/concepts/resolution.md`). The file is about 42 KB, so this page holds, in Codeman's words, only what a resolver relies on: the cutoff by upload date, the cooldown and constraints.

## Reproducible resolutions

- `--exclude-newer <date>` limits resolution to files uploaded before the date. The date is compared with each file's upload time, not with the release date of the version ([reproducible resolutions](https://docs.astral.sh/uv/concepts/resolution/#reproducible-resolutions)).
- The index must give `upload-time` (PEP 700). A file without it is treated as unavailable, unless the package or the index is opted out. PyPI gives it for every file.
- When a resolution fails, the message does not say that files were excluded by the cutoff: newer files are treated as if they did not exist.
- `--exclude-newer-package <package>=<date>` sets a cutoff for one package, and takes precedence over the global and the index cutoffs; `<package>=false` removes it. The page names this as the way to use a newer version of one package temporarily.

## Dependency cooldowns

- A duration instead of a date makes a cooldown: a "friendly" one (`24 hours`, `1 week`, `30 days`) or ISO 8601 (`PT24H`, `P7D`). A day is 24 hours; months and years are refused ([dependency cooldowns](https://docs.astral.sh/uv/concepts/resolution/#dependency-cooldowns)).
- The duration is resolved against the current time. `uv.lock` records the resulting timestamp; a `uv pip compile` output is not said to.
- `--exclude-newer-package` accepts a duration too, such as `setuptools=30 days`.

## Dependency constraints

- `--constraint <file>` narrows the versions of packages already in the resolution; a constraint alone does not add a package ([dependency constraints](https://docs.astral.sh/uv/concepts/resolution/#dependency-constraints)).
