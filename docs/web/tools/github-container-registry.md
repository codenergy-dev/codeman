---
title: GitHub container registry
url: https://ghcr.io
created_at: 2026-10-19T14:31:27-03:00
updated_at: 2026-10-19T14:31:27-03:00
---

# GitHub container registry

How to record what a public image on `ghcr.io` is: its tags, digests, sizes and configuration, without pulling its layers. Images such as `catthehacker/ubuntu`, which act runs by default.

- **Source.** The registry's API, with an anonymous token for the repository. A tag's manifest gives the index digest (`docker-content-digest`) and, per platform, the manifest digest. The platform's manifest gives each layer's compressed `size`, and the digest of its configuration blob, which holds the user, environment and labels.
- **License.** An image's configuration is data, not documentation. Pages are recorded in your own words, without `license`: the facts the repository relies on, each naming the field it comes from.
- **Title and URL.** One page per image, titled after the image and the tags it covers, with the package's page on GitHub as `url` (`https://github.com/<owner>/<repo>/pkgs/container/<name>`).

```sh
IMAGE=catthehacker/ubuntu TAG=act-latest
TOKEN=$(curl -fsS "https://ghcr.io/token?scope=repository:$IMAGE:pull" | jq -r .token)
ACCEPT='application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'
curl -fsS -D - -H "Authorization: Bearer $TOKEN" -H "Accept: $ACCEPT" "https://ghcr.io/v2/$IMAGE/manifests/$TAG"
MANIFEST=sha256:...   # the linux/amd64 digest from the index
curl -fsS -H "Authorization: Bearer $TOKEN" -H "Accept: $ACCEPT" "https://ghcr.io/v2/$IMAGE/manifests/$MANIFEST" | jq '{config: .config.digest, size: ([.layers[].size] | add)}'
curl -fsSL -H "Authorization: Bearer $TOKEN" "https://ghcr.io/v2/$IMAGE/blobs/sha256:..." | jq '{created, config: .config | {User, Env, Labels}}'
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3, for a page in your own words.
