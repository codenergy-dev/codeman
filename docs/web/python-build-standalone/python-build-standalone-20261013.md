---
title: python-build-standalone 20261013
url: https://github.com/astral-sh/python-build-standalone/releases/tag/20261013
created_at: 2026-10-30T11:40:01-03:00
updated_at: 2026-10-30T11:40:01-03:00
tool: docs/web/tools/github-releases.md
---

# python-build-standalone 20261013

What the multi-service pods experiment relies on, in its own words, from GitHub's API on 2026-10-30. See the [python-build-standalone tool](../tools/python-build-standalone.md).

## The release

From `GET /repos/astral-sh/python-build-standalone/releases/tags/20261013`:

| Field | Value |
| --- | --- |
| `published_at` | 2026-10-14T02:06:09Z |
| `immutable` | `true`: its assets cannot be replaced after publication |
| `target_commitish` | `9e40cba825ca0997a01cab9f60a0b15ffb976af2` |
| Assets | 991 archives (every Python version, target and flavor), and `SHA256SUMS` |

The release after it, `20261026`, was 4 days old on 2026-10-30.

## The asset the experiment uses

| Field | Value |
| --- | --- |
| `name` | `cpython-3.12.15+20261013-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz` |
| `size` | 34340172 bytes (about 34 MB); the `install_only` archive with debug symbols is about twice as large |
| `digest` | `sha256:178d3d83b6e8e99285a65d3fce9c16b87952cc5efdb4d1a0e3ff3be18ff0fc9c` |
| `SHA256SUMS` | lists the same SHA-256 for this name |

The archive holds one directory, `python/`; extracted, it uses about 103 MB.

## Verification it offers

- **Checksums.** Each asset's `digest` (computed by GitHub on upload) and the release's `SHA256SUMS` file. Both come from the same release: they prove integrity, not who built the file.
- **Attestations.** `GET /repos/astral-sh/python-build-standalone/attestations/sha256:178d3d83…` lists 2 Sigstore bundles:
  - `predicateType` `https://slsa.dev/provenance/v1`, from the workflow `.github/workflows/release.yml` at `refs/heads/main`, resolved to commit `9e40cba825ca0997a01cab9f60a0b15ffb976af2`; one statement covers 990 subjects.
  - `predicateType` `https://in-toto.io/attestation/release/v0.2`, covering 992 subjects.
- Verifying a bundle's signature needs a Sigstore client (such as `gh attestation verify`), which neither the pod image nor Node's built-ins provide.

## The repository

From `GET /repos/astral-sh/python-build-standalone`: license `MPL-2.0`, created 2018-12-18, last push 2026-10-29, 4536 stars, not archived.
