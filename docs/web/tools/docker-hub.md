---
title: Docker Hub
url: https://hub.docker.com
created_at: 2026-10-13T20:50:08-03:00
updated_at: 2026-10-13T20:50:08-03:00
---

# Docker Hub

How to record what a public image on Docker Hub is: its tags, digests, sizes and configuration, such as `vllm/vllm-openai`, which Codeman's pod image builds on.

- **Source.** Docker Hub's API gives a tag's index digest, its date and, per platform, the manifest digest and the compressed size (`size`, in bytes): `https://hub.docker.com/v2/repositories/<namespace>/<repository>/tags/<tag>`. The registry gives an image's configuration (environment, entry point, labels) without pulling its layers: an anonymous token from `auth.docker.io`, then the platform's manifest, then the blob of its `config.digest`.
- **License.** Docker Hub's terms state no license that allows copying its pages, and an image's configuration is data, not documentation. Pages are recorded in your own words, without `license`: the facts the repository relies on, each naming the API field or configuration key it comes from.
- **Title and URL.** One page per image and version, titled after the image and tag, such as "vllm/vllm-openai:v0.31.0", with the tag's page on Docker Hub as `url` (`https://hub.docker.com/r/<namespace>/<repository>/tags?name=<tag>`).

```sh
REPO=vllm/vllm-openai TAG=v0.31.0
curl -fsS "https://hub.docker.com/v2/repositories/$REPO/tags/$TAG" | jq '{digest, last_updated, images: [.images[] | {architecture, digest, size}]}'
TOKEN=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$REPO:pull" | jq -r .token)
MANIFEST=sha256:...   # the linux/amd64 digest from the first call
CONFIG=$(curl -fsS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.manifest.v1+json" \
  "https://registry-1.docker.io/v2/$REPO/manifests/$MANIFEST" | jq -r .config.digest)
curl -fsSL -H "Authorization: Bearer $TOKEN" "https://registry-1.docker.io/v2/$REPO/blobs/$CONFIG" | jq .config
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3, for a page in your own words.
