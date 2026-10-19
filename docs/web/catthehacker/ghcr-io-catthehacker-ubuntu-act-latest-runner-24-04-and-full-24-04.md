---
title: "ghcr.io/catthehacker/ubuntu: act-latest, runner-24.04 and full-24.04"
url: https://github.com/catthehacker/docker_images/pkgs/container/ubuntu
created_at: 2026-10-19T14:32:43-03:00
updated_at: 2026-10-19T14:32:43-03:00
tool: docs/web/tools/github-container-registry.md
---

# ghcr.io/catthehacker/ubuntu: act-latest, runner-24.04 and full-24.04

What Codeman relies on, in its own words, from the registry's manifests and each image's configuration (see the tool), for linux/amd64. act runs `act-latest` for `ubuntu-latest` by default ([act's runners](../nektos/act-docs-src-usage-runners-md-at-35cab61.md)).

| Tag | Index digest | Compressed size | Created | User (`config.User`) | `PATH` (`config.Env`) |
| --- | --- | --- | --- | --- | --- |
| `act-latest`, same digest as `act-24.04` | `sha256:62d572b92f9f32d3427b6d220ad1f9dca9c7b6ffad37d295425037dbff78abaf` | 0.58 GB, 6 layers | 2026-08-15, from `docker_images` at `e2f8efe` (label `org.opencontainers.image.revision`) | `root` | `/opt/acttoolcache/node/24.19.0/x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin` |
| `runner-24.04` | `sha256:7cf0c248d11d5fa156acd3738965fe118ad686da273edb4891474b812eecd4c0` | 0.58 GB, 8 layers | 2026-08-15, same revision | `runner` | Same as `act-latest`; also `RUNNER_TEMP=/home/runner/work/_temp` |
| `full-24.04`, same digest as `full-latest` | `sha256:86f3a5bbfee046bad1be4ea5ad78f2b52cf58ba20d692dd3ab318271d72d9416` | 18.97 GB, 18 layers | 2026-09-16; label `org.opencontainers.image.version` is `ubuntu24-runner-large-20260907.300.1-amd64`, `ImageVersion=20260907.300.1` | `1001:1001` | `/snap/bin:/home/runner/.local/bin:/opt/pipx_bin:/home/runner/.cargo/bin:/home/runner/.config/composer/vendor/bin:/usr/local/.ghcup/bin:/home/runner/.dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin` |

- `act-latest` and `runner-24.04` are built by `act.sh` ([script](docker-images-linux-ubuntu-scripts-act-sh-at-e2f8efe.md)): Ubuntu with a few packages, Node.js in `/opt/acttoolcache`, and `/opt/hostedtoolcache` mode `0777`. Their `PATH` has no `/opt/pipx_bin`, and the script does not make `/usr/share`, `/opt` or `/usr/local/bin` writable by every user.
- `full-24.04` is a copy of a GitHub-hosted runner's file system ([README](docker-images-readme-md-at-e2f8efe.md)), here of image version `20260907.300.1`. Its `PATH` is the one GitHub's `ubuntu-24.04` has with no setup action.
