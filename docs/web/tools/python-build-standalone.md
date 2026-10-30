---
title: python-build-standalone
url: https://docs.astral.sh/python-build-standalone/
created_at: 2026-10-30T11:40:01-03:00
updated_at: 2026-10-30T11:40:01-03:00
---

# python-build-standalone

How to record pages of python-build-standalone, the relocatable CPython builds of [astral-sh/python-build-standalone](https://github.com/astral-sh/python-build-standalone), and its releases.

- **Pages.** The site, `docs.astral.sh/python-build-standalone`, is built from `docs/*.md` in the repository; its pages do not answer with `.md` appended. Take the raw file at the release tag the repository relies on: `https://raw.githubusercontent.com/astral-sh/python-build-standalone/<tag>/docs/<page>.md`, such as `20261013/docs/running.md`. The `url` is the page on the site, such as `https://docs.astral.sh/python-build-standalone/running/`; the title is the file's first heading.
- **License.** The repository, documentation included, is MPL-2.0. Check that the tag's `LICENSE` still says so, then copy pages in full, with `license: MPL-2.0`.
- **Releases.** A release is tagged by its date, such as `20261013`, and holds one archive per Python version, target and flavor, with a `SHA256SUMS` file. Record it with the [GitHub releases tool](github-releases.md), and check each asset you rely on against both its GitHub `digest` and its line in `SHA256SUMS`.
- **Attestations.** `https://api.github.com/repos/astral-sh/python-build-standalone/attestations/sha256:<digest>` lists the GitHub attestations of an asset, as Sigstore bundles. The statement is base64 in `bundle.dsseEnvelope.payload`: record its `predicateType` and the workflow it names, in your own words. Verifying the bundle's signature needs a Sigstore client, such as `gh attestation verify`.

```sh
TAG=20261013
curl -fsS "https://raw.githubusercontent.com/astral-sh/python-build-standalone/$TAG/LICENSE" | head -1
curl -fsS "https://raw.githubusercontent.com/astral-sh/python-build-standalone/$TAG/docs/running.md"
curl -fsS "https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/$TAG" | jq '{published_at, immutable}'
curl -fsS "https://api.github.com/repos/astral-sh/python-build-standalone/attestations/sha256:<digest>" \
  | jq -r '.attestations[].bundle.dsseEnvelope.payload' | base64 -d | jq '{predicateType}'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
