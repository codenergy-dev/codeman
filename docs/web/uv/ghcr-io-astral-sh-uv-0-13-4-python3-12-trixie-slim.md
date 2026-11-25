---
title: "ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim"
url: https://github.com/astral-sh/uv/pkgs/container/uv
created_at: 2026-10-30T11:50:13-03:00
updated_at: 2026-10-30T11:50:13-03:00
tool: docs/web/tools/github-container-registry.md
---

# ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim

uv's official image with Python 3.12 on Debian trixie, which the resolver experiment runs `uv pip compile` in. Read from `ghcr.io`'s registry API with an anonymous token.

| Fact | Value | Field |
| --- | --- | --- |
| Index digest | `sha256:0d42b7b065ada5139af940bf3fb178b926675450e786badc854c9f73736cc6c4` | `docker-content-digest` of the tag |
| linux/amd64 manifest | `sha256:abd83c5eb62ce12e1e76f0aeb1f7e77b02431fa4c5b6a69b53d679dfd3f9ba47`, 62,658,983 bytes of layers | the index's `manifests[]`, the manifest's `layers[].size` |
| Attestations | One BuildKit attestation manifest per platform (`vnd.docker.reference.type: attestation-manifest`); for 0.13.1 its layers were an SPDX document and SLSA provenance v0.2 | the index's `manifests[].annotations`, the attestation's `layers[].annotations["in-toto.io/predicate-type"]` |
| Referrers API | `404` on `ghcr.io` | `GET /v2/astral-sh/uv/referrers/<digest>` |
| Created | 2026-10-20T14:51:58Z | the config's `created` |
| Source | `org.opencontainers.image.revision` `7456b60bc6bc348e13e06e3691bf08e78d3aef54`, the commit of the tag 0.13.4 | the config's `Labels` |
| User | Not set: root | the config's `User` |
