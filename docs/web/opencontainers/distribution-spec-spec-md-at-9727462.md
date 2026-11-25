---
title: "distribution-spec: spec.md at 9727462"
url: https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md
created_at: 2026-10-30T11:49:09-03:00
updated_at: 2026-10-30T11:49:09-03:00
tool: docs/web/tools/github-repositories.md
---

# distribution-spec: spec.md at 9727462

The OCI Distribution Specification, the registry API that Docker Hub and `ghcr.io` implement, at commit `9727462`. The repository is Apache-2.0, but the file is about 54 KB, so this page holds, in Codeman's words, only what a resolver relies on.

## Pulling manifests

- `GET /v2/<name>/manifests/<tag-or-digest>`, with an `Accept` header listing the manifest types the client reads ([pulling manifests](https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md#pulling-manifests)).
- The response carries `Docker-Content-Digest`; a client that uses it must check it matches the body, and a client that asked by digest should check the body matches that digest. A tag, unlike a digest, can point at another manifest later.
- A missing manifest answers `404 Not Found`.

## Listing referrers

- `GET /v2/<name>/referrers/<digest>` lists the manifests whose `subject` is that digest, such as signatures, SBOMs and attestations, as an image index ([listing referrers](https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md#listing-referrers)).
- A registry that supports it answers `200` with an empty `manifests` list when there are none, and never `404`. Each descriptor has an `artifactType` and the manifest's annotations; `?artifactType=` filters.
- A `404` means the registry does not support it: the client must fall back to the tag `<algorithm>-<encoded>`, such as `sha256-<hex>`, which should hold the same index ([unavailable referrers API](https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md#unavailable-referrers-api), [referrers tag schema](https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md#referrers-tag-schema)).
