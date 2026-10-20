# Running Actions locally

This page is for whoever changes code that depends on GitHub's `ubuntu-latest` runner, such as the [sandbox](../glossary.md#sandbox). It shows how to run that code on your machine, in a small image that reproduces what it depends on, and how far that image is from GitHub's.

## What the image reproduces

[`docker/runner/Dockerfile`](../../docker/runner/Dockerfile) builds `codeman-runner:local`. It reproduces only what Codeman's runner-dependent code sees on `ubuntu-latest`:

| What | In the image | Source |
| --- | --- | --- |
| The system | Ubuntu 24.04, by digest | `ubuntu-latest` is Ubuntu 24.04 on x64 ([runner-images README](../web/github/runner-images-readme-md-at-82d1b86.md)) |
| The runner's user | `runner`, uid 1001, with passwordless `sudo` | [Administrative privileges](../web/github/github-hosted-runners-reference.md#administrative-privileges) |
| Node.js | 24.21.0, in `/opt/hostedtoolcache/node/24.21.0/x64`, marked complete, where `actions/setup-node` finds a cached version | `.nvmrc`, and the version of the [pod images](dependencies.md#codemans-pod-images) |
| World-writable trees | `/opt` and `/usr/share`, recursively, with `/opt/pipx_bin` and the tool cache; `/usr/local/bin`, `/usr/local/lib/node_modules` and `/usr/local/.ghcup` | [`configure-system.sh`](../web/github/runner-images-configure-system-sh-at-82d1b86.md), [`install-nodejs.sh`](../web/github/runner-images-install-nodejs-sh-at-82d1b86.md), [`install-haskell.sh`](../web/github/runner-images-install-haskell-sh-at-82d1b86.md) |
| The job's `PATH` | x64's, in GitHub's order, after setup-node's tool-cache directory | [Issue 11414](../web/github/path-is-different-on-ubuntu-24-04-arm-compared-to-ubuntu-24-04.md) |
| The programs Codeman runs | `git`, `sudo`, `procps` (`pkill`, `pgrep`), `unzip`, and Ubuntu's base | Ubuntu's packages |

## Run the tests

You need Docker. The first run builds the image, in a few minutes.

1. Run `npm run test:runner`. The script copies your working tree, without `node_modules`, to `/home/runner/work/codeman/codeman`, then runs `npm ci` and `npm test` there as `runner`, with `CODEMAN_SANDBOX_TEST=1`. The output ends as CI's does, with every sandbox test passed, none skipped.
2. To run another command there, after `npm ci`, pass it after `--`:

   ```sh
   npm run test:runner -- node --test src/sandbox.test.ts
   npm run test:runner -- bash
   ```

- The working tree is mounted read-only: nothing in the container changes your files.
- The container has the network, for `npm ci`, and no Docker socket.
- The container gets `--cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined`. The agent's [jail](../runs/agent.md#the-jail) runs `unshare` and `mount` as root, which Docker's default capabilities, seccomp profile and AppArmor profile deny in a container. GitHub's VM needs none of them: there, root has every capability.
- Each run starts from the image again, so users and files a test creates do not last.

> [!IMPORTANT]
> The script runs the container with `--init`. Without it, the sandbox test fails with "A process of the agent survived": a killed process stays a zombie that `pgrep` lists, since nothing reaps it. On GitHub's VM, systemd does.

## How far it is from GitHub's runner

| | GitHub's `ubuntu-latest` | The local image |
| --- | --- | --- |
| Machine | A VM per job, with systemd | A container, with `tini` as PID 1 and no systemd: `loginctl`, lingering and user services are not tested. No `sshd`, `cron`, `atd` or system bus either: the sandbox test of the system's services finds each route missing |
| Root file system | ext4 | overlayfs. Docker mounts `/etc/hosts` and `/etc/resolv.conf` apart, so `find -xdev` stops there |
| `runner` | uid 1001, passwordless `sudo`; its groups and its exact `sudoers` rule are not recorded | uid 1001, group 1001, `NOPASSWD:ALL` in `/etc/sudoers.d/runner`, Ubuntu's `secure_path`. The base image's `ubuntu` user, uid 1000, stays |
| Permissions | The build scripts' world-writable trees, and whatever else the image leaves open | Only the build scripts' trees |
| `PATH` | x64's, plus each setup action's entries | x64's, plus setup-node's entry |
| Software | Thousands of tools; git from a PPA; Docker, cron and `at` | Ubuntu's base, Node.js, git 2.43, `sudo`, `procps`, `unzip` |
| Docker | A socket | None: the sandbox test's Docker check passes without testing anything |
| Namespaces and mounts | Root has every capability | Granted by `scripts/runner.sh`'s flags; the kernel is Docker's, without AppArmor |
| Architecture | x64; `ubuntu-24.04-arm` for arm64 | The host's; arm64 is not tested |

A test that passes here can still fail on GitHub's runner, which has more tools and more open paths: CI stays the check before merging.

## Update the image

- **Ubuntu:** change the `FROM ubuntu:noble-<date>@sha256:<digest>` line, and record the new tag's page in `docs/web/docker-hub/` ([Docker Hub tool](../web/tools/docker-hub.md)).
- **Node.js:** change the `FROM node:<version>-bookworm-slim@sha256:<digest>` line and `NODE_VERSION` together, with the pod images' ([dependencies](dependencies.md#the-local-runner-image)).
- **GitHub's image:** when `actions/runner-images` changes the permissions or the `PATH` this page cites, record the new files in `docs/web/github/` and change the Dockerfile with them.

The image's audit is in [dependencies](dependencies.md#the-local-runner-image).
