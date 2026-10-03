---
title: Package Metadata
url: https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
created_at: 2026-10-02T21:54:59-03:00
updated_at: 2026-10-02T21:54:59-03:00
tool: docs/web/tools/fetch-markdown.md
---

# Package Metadata

What Codeman relies on, in its own words. The [npm/registry](https://github.com/npm/registry) repository states no license, so the page is not copied.

## Request

`GET https://registry.npmjs.org/<package>` returns the package's metadata as JSON: the full document by default, or an abbreviated one, with only what installing needs, with `Accept: application/vnd.npm.install-v1+json`.

## Versions and tarballs ("Components of the metadata", `dist`)

- The registry's metadata of a package lists each published version, and each version's `dist` object describes its tarball.
- `dist.tarball` is the tarball's URL. For a package without a scope it has the form `https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`, as in the page's `tiny-tarball` example.
- `dist.integrity` (since April 2017) is `<hashAlgorithm>-<base64-hash>`, in the Subresource Integrity format, such as `sha512-…`: the hash of the tarball's bytes.
- `dist.shasum` is the tarball's SHA-1.

Codeman downloads a harness's tarball from its `dist.tarball` URL and compares the SHA-512 of its bytes with the pinned `dist.integrity` before extracting it ([dependencies](../../dependencies.md)).
