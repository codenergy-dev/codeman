# Running Actions locally

This page is for whoever changes code that depends on GitHub's Ubuntu runner, such as the [sandbox](../glossary.md#sandbox). It shows how to run that code on your machine, in a small image that reproduces what it depends on, and how far that image is from GitHub's.

## What the image reproduces

[`docker/runner/Dockerfile`](../../docker/runner/Dockerfile) builds `codeman-runner:local`. It reproduces only what Codeman's runner-dependent code sees on `ubuntu-26.04`, image 20261116.202.1, built from `actions/runner-images` at `3556d77`, the commit of its release tag `ubuntu26/20261116.202`:

| What | In the image | Source |
| --- | --- | --- |
| The system | Ubuntu 26.04, by digest | CI's job `check-ubuntu-26-04` runs on `ubuntu-26.04`, where the templates move after [the review](../plans/2026-11-05-review-codeman-on-ubuntu-26-04.md); they run on `ubuntu-24.04` until then ([setup](../installation/setup.md#what-you-need)) |
| The runner's user | `runner`, uid 1001, with passwordless `sudo` | [Administrative privileges](../web/github/github-hosted-runners-reference.md#administrative-privileges) |
| Node.js | 24.22.1, in `/opt/hostedtoolcache/node/24.22.1/x64`, marked complete, where `actions/setup-node` finds a cached version | `.nvmrc`, and the version [pods download](dependencies.md#nodejs-for-pods) |
| World-writable trees | `/opt` and `/usr/share`, recursively, with `/opt/pipx_bin` and the tool cache; `/usr/local/bin`, `/usr/local/lib/node_modules` and `/usr/local/.ghcup` | [`configure-system.sh`](../web/github/runner-images-configure-system-sh-at-3556d77.md), [`install-nodejs.sh`](../web/github/runner-images-install-nodejs-sh-at-3556d77.md), [`install-haskell.sh`](../web/github/runner-images-install-haskell-sh-at-3556d77.md) |
| The job's `PATH` | x64's, in GitHub's order, after setup-node's tool-cache directory | [Issue 11414](../web/github/path-is-different-on-ubuntu-24-04-arm-compared-to-ubuntu-24-04.md), for `ubuntu-24.04`. [`build.ubuntu-26_04.pkr.hcl`](../web/github/runner-images-build-ubuntu-26-04-pkr-hcl-at-3556d77.md) runs the same scripts that prepend to it, in the same order, so it is unchanged |
| The environment | `RUNNER_TOOL_CACHE`, `AGENT_TOOLSDIRECTORY`, `PIPX_BIN_DIR`, `PIPX_HOME`, and `ImageOS=ubuntu26` | [`configure-environment.sh`](../web/github/runner-images-configure-environment-sh-at-3556d77.md), [`install-python.sh`](../web/github/runner-images-install-python-sh-at-3556d77.md), [`locals.ubuntu.pkr.hcl`](../web/github/runner-images-locals-ubuntu-pkr-hcl-at-3556d77.md) |
| The programs Codeman runs | `git`, `procps` (`pkill`, `pgrep`), `unzip`, and Ubuntu's base | Ubuntu's packages |
| `sudo` | `/usr/bin/sudo` is `sudo-rs`: the image installs `sudo` and `sudo-rs`, as the runner has both, and `sudo-rs`'s alternative wins | [`sudo-rs`](../web/ubuntu/usr-lib-cargo-bin-sudo-in-sudo-rs-0-2-13-0ubuntu1-2-amd64-deb.md) |
| coreutils | The runner's mix: `cp`, `mv`, `rm`, `df` and `true` are GNU's, the rest, `dd` among them, uutils'. The base image's `coreutils-from-uutils` links them so; the build fails if `sudo`, `cp` or `dd` changes | [`coreutils-from`](../web/ubuntu/coreutils-from-0-0-0-ubuntu25-source-package.md) |
| `bwrap` | From `bubblewrap`, which the runner has through other packages, not its [toolset's apt list](../web/github/runner-images-toolset-2604-json-at-3556d77.md) | [`bubblewrap`](../web/ubuntu/usr-bin-bwrap-in-bubblewrap-0-11-1-1ubuntu0-3-amd64-deb.md) |

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

| | GitHub's `ubuntu-26.04` | The local image |
| --- | --- | --- |
| Machine | A VM per job, with systemd | A container, with `tini` as PID 1 and no systemd: `loginctl`, lingering and user services are not tested. No `sshd`, `cron`, `atd` or system bus either: the sandbox test of the system's services finds each route missing |
| Root file system | ext4 | overlayfs. Docker mounts `/etc/hosts` and `/etc/resolv.conf` apart, so `find -xdev` stops there. Docker's `/etc/hosts` maps `localhost` to `::1` as well as `127.0.0.1` |
| `runner` | uid 1001, passwordless `sudo`; its groups and its exact `sudoers` rule are not recorded | uid 1001, group 1001, `NOPASSWD:ALL` in `/etc/sudoers.d/runner`, Ubuntu's `secure_path`. The base image's `ubuntu` user, uid 1000, stays |
| `sudo`, `cp`, `dd`, `bwrap` | sudo-rs 0.2.13; GNU's `cp` 9.7; uutils' `dd` 0.10.0; bubblewrap 0.11.1 | The same, by the sandbox test's report |
| Permissions | The build scripts' world-writable trees, and whatever else the image leaves open | Only the build scripts' trees |
| `PATH` | x64's, plus each setup action's entries | x64's, plus setup-node's entry |
| Software | Thousands of tools; git 2.56 from a PPA; Docker | Ubuntu's base, Node.js, git 2.53, `sudo` and `sudo-rs`, `bubblewrap`, `procps`, `unzip`, and Python 3, which `sudo-rs` depends on |
| Docker | A socket | None: the sandbox test's Docker check passes without testing anything |
| Namespaces and mounts | Root has every capability | Granted by `scripts/runner.sh`'s flags; the kernel is Docker's |
| AppArmor | `kernel.apparmor_restrict_unprivileged_userns` is 1; `unprivileged_userns`, `bwrap` and `unpriv_bwrap` are enforced. In the jail, `unshare` cannot create a user namespace, and `bwrap` can | None: no sysctl, no profile. In the jail, `unshare` and `bwrap` both create one. The jail's mounts hold either way: the sandbox test finds `/tmp` and the system bus hidden, and `/usr/local/bin` read-only |
| Architecture | x64; arm64 has an image of its own | The host's; arm64 is not tested |

A test that passes here can still fail on GitHub's runner, which has more tools and more open paths: CI stays the check before merging.

## The workflows under act

This image runs one job's code. Codeman's real templates, job after job, run under act 0.2.89 in the e2e suite's smoke scenarios, in the suite's job image, which is this one with `gh` and the suite's test CA: see [under act](e2e/suite.md#under-act). act runs the jobs' `ubuntu-24.04` label in it, though it is Ubuntu 26.04, until the templates move (step 6 of [the review](../plans/2026-11-05-review-codeman-on-ubuntu-26-04.md#steps)).

## Update the image

- **Ubuntu:** change the `FROM ubuntu:resolute-<date>@sha256:<digest>` line, and record the new tag's page in `docs/web/docker-hub/` ([Docker Hub tool](../web/tools/docker-hub.md)).
- **Node.js:** change the `FROM node:<version>-bookworm-slim@sha256:<digest>` line and `NODE_VERSION` together ([dependencies](dependencies.md#the-local-runner-image)).
- **GitHub's image:** when `actions/runner-images` changes the permissions or the `PATH` this page cites, record the new files in `docs/web/github/` and change the Dockerfile with them.

The image's audit is in [dependencies](dependencies.md#the-local-runner-image).
