---
status: completed
created_at: 2026-10-19T14:34:08-03:00
updated_at: 2026-10-19T15:02:26-03:00
commit: db04a9c
---

# Run GitHub Actions locally

## Goal

A developer runs, on their own machine, the code that depends on GitHub's `ubuntu-latest` runner: the runner's user and `sudo`, the image's permissions, and the job's `PATH`. One command builds a small runner image and runs any command in it, such as CI's tests with the sandbox test.

## Context

- The sandbox tests ([`src/sandbox.test.ts`](../../src/sandbox.test.ts)) run only on Linux with `CODEMAN_SANDBOX_TEST=1`, as a user with passwordless `sudo`. Today only CI runs them, after a push ([tests](../development/guide.md#tests)).
- The [plan for privileged tools](2026-10-19-resolve-privileged-tools-outside-the-agents-reach.md) needs more: its escape depends on the image's world-writable `/opt`, `/usr/share` and `/usr/local/bin`, and on the job's `PATH` order. Its reproduction could not cover the image's side without a Linux runner.
- The environment must serve other work too, so its Docker configuration is committed.
- `AGENTS.md` asks for an audit before adding a tool, and for the smallest setup that does the job.

### The machine of this plan

macOS x86_64, Docker Desktop with Docker 29.3.1 (linux/amd64), Node 24 through nvm, no `gh`. act 0.2.74 is installed with Homebrew.

### Audit

Pages in `docs/web/nektos/`, `docs/web/catthehacker/`, `docs/web/homebrew/` and `docs/web/github/`, fetched on 2026-10-19.

| | Plain Dockerfile, `docker run` | act ([nektos/act](https://github.com/nektos/act)) | Runner ([actions/runner](https://github.com/actions/runner)) | local-action ([github/local-action](https://github.com/github/local-action)) |
| --- | --- | --- | --- | --- |
| What it does | Builds an image and runs a command in it | Reads `.github/workflows/`, runs each job in a Docker container, each step by `docker exec` ([act's runners](../web/nektos/act-docs-src-usage-runners-md-at-35cab61.md)) | The program that runs a job on a GitHub-hosted or self-hosted runner ([README](../web/github/runner-readme-md-at-197ca02.md)) | Runs one JavaScript or TypeScript action's source on the host, with the Actions toolkit stubbed ([README](../web/github/local-action-readme-md-at-afcb88e.md)) |
| Sandbox tests on a runner-like Linux | Yes, with `--init` | Yes, with the same image and four flags (prototype) | Only on a self-hosted runner that GitHub sends jobs to | No: it runs on the host, here macOS |
| A workflow such as `ci.yml`, locally | No: it runs commands, not workflows | Partly. The installed 0.2.74 refuses `actions/setup-node`'s `node24` (support came in 0.2.81). Ignored: `permissions`, `timeout-minutes`, `concurrency`, OIDC ([not supported](../web/nektos/act-docs-src-not-supported-md-at-35cab61.md)) | No: a job comes only from GitHub, after a push | No: one action, not a job |
| A templates job | No | Not usefully: those jobs need the GitHub App, OIDC and Codeman's API calls | Yes, as a self-hosted runner, after a push | No: it stubs `@actions/core` 2.0.2 and `@actions/github` 7.0.0, Codeman uses 3.0.1 and 9.1.1, and it does not support bundled code such as `dist/` |
| License | Docker Engine Apache-2.0; Docker Desktop's subscription terms apply to the developer's organization | MIT | MIT | MIT |
| Maintenance | Docker, Inc. | Community; a release a month until v0.2.89 (2026-06-01), no commit on `master` since | GitHub; v2.338.0 on 2026-10-06. Not taking contributions; security fixes continue ([README](../web/github/runner-readme-md-at-197ca02.md)) | GitHub; one main contributor; v7.0.1 on 2026-02-18 |
| Known vulnerabilities | None in what the image adds; Ubuntu's and Node's are the image's | Installed 0.2.74 has two high ones, fixed in 0.2.86: `::set-env::` and `::add-path::` processed from any step's output ([CVE-2026-34041](../web/nektos/set-env-and-add-path-workflow-commands-unconditionally-processed.md)); an unauthenticated cache server on every interface ([CVE-2026-34042](../web/nektos/remote-code-execution-possible-actions-cache-server-allows-malicious-cache-injec.md)) | CVE-2022-39321, fixed in 2.296.2 | `npm audit` of its tree: 2 high, 4 moderate, in `undici` and `@fastify/busboy` |
| What it installs | One image from pinned inputs: `ubuntu:noble-20260930.1` ([digest](../web/docker-hub/ubuntu-noble-20260930-1.md)), Node.js from the pod images' pinned `node:24.21.0-bookworm-slim`, and 5 Ubuntu packages | One Go binary (38 direct, 61 indirect modules). By default it pulls `catthehacker/ubuntu:act-latest`, 0.58 GB, root, built by a script that pipes a remote script into `bash` ([image](../web/catthehacker/ghcr-io-catthehacker-ubuntu-act-latest-runner-24-04-and-full-24-04.md), [act.sh](../web/catthehacker/docker-images-linux-ubuntu-scripts-act-sh-at-e2f8efe.md)). It clones each action from GitHub | The runner's release (.NET), registered with a token that expires after an hour ([adding runners](../web/github/adding-self-hosted-runners.md)) | 378 npm packages, 2 with install scripts (`esbuild`, `fsevents`) |
| Permissions it needs | The Docker daemon. The container gets the working tree read-only, the network, and no Docker socket | The Docker daemon. By default it mounts the Docker socket into the job's container, runs it on the host network, and starts a cache server on the LAN address | A repository's or organization's admin to register it; it then runs any job GitHub sends, with the machine's permissions | The developer's user, on the host |
| Verdict | **Adopt** | Not now: see decision 1 | Reject: not local, and a self-hosted runner on a public repository runs untrusted code | Reject: wrong layer, wrong versions |

How Homebrew checked the installed act: it was poured from a bottle, from the formula in Homebrew's JSON API ([formula](../web/homebrew/formula-act.md)). That API's files are JWS-signed and verified before use; the bottle's SHA-256 is in the formula, built from source by Homebrew's CI. Build-provenance attestations are checked only with `HOMEBREW_VERIFY_ATTESTATIONS` and `gh` ([Homebrew's supply chain](../web/homebrew/brew-docs-homebrew-security-and-supply-chain-md-at-41f40de.md)), so they were not.

### What the prototype proved

Files in the session's scratchpad: `proto/docker/runner/Dockerfile`, `proto/scripts/runner.sh`, `proto/escape.test.ts`, `proto/workflows/sandbox.yml`.

1. **The image.** `ubuntu:noble-20260930.1` by digest; `runner`, uid 1001, with `runner ALL=(ALL) NOPASSWD:ALL` in `/etc/sudoers.d/runner`; Node.js 24.21.0 and npm 11.19.0 in `/opt/hostedtoolcache/node/24.21.0/x64`, marked complete, where `actions/setup-node` finds a cached version; git 2.43.0. `/opt`, `/usr/share`, `/usr/local/bin`, `/usr/local/lib/node_modules` and `/usr/local/.ghcup` are `777`, recursively, set last. The `PATH` is issue 11414's x64 `PATH` with the tool-cache directory first ([issue](../web/github/path-is-different-on-ubuntu-24-04-arm-compared-to-ubuntu-24-04.md)). The first build took 4 minutes.
2. **CI's tests, as `runner`, at `db04a9c` with this working tree.** `npm ci`, then `npm test` with `CODEMAN_SANDBOX_TEST=1`: 632 tests, 618 pass, 0 fail, 14 skipped (the Firestore emulator's, as on CI). The 3 sandbox tests pass. About 20 seconds once built.
3. **`--init` is needed.** Without it, the first sandbox test fails: "A process of the agent survived". A killed process stays a zombie that `pgrep` lists, because no process reaps orphans; on the VM, systemd does.
4. **The escape reproduces.** As `codeman-agent`, through `runAsAgent`, the scratch test planted `/opt/pipx_bin/sudo` and `/usr/local/bin/git`, each logging who ran it, then running the real one:
   - `killAgentProcesses()`, `sudoCapture(["test", "-d", "/"])` and `sudo(["true"])` ran the planted `sudo`, as `runner`.
   - `sudo(["git", "--version"])` ran the planted `git` as root: `sudo` found it through `secure_path`.
   - A later `git`, as `actions/checkout`'s post step runs it, ran the planted one as `runner`.
5. **act with this image.** `act -P ubuntu-latest=codeman-runner:local --pull=false --no-cache-server --container-daemon-socket - --container-options --init --env RUNNER_TEMP=/home/runner/work/_temp` ran a scratch workflow (checkout, `npm ci`, the sandbox tests): the 3 tests pass, as `runner`, with the image's `PATH`. `ci.yml`'s `check` job fails before its first step: act 0.2.74 refuses `node24`.
   - Without `--env RUNNER_TEMP=...`, act sets `RUNNER_TEMP=/tmp`, and the test "the agent cannot read the job's temporary files" fails.
   - act puts the workspace at the host's path, here under `/Users/`, outside the runner's home, which on GitHub holds it.

### Measuring the walk

The other plan's step 2 measures, on `ubuntu-latest` in CI, a walk that removes others' write access on the root file system. In this image, as `runner`:

| Measure | Result |
| --- | --- |
| Entries on the root file system | 8,891 |
| Writable by others, not sticky (`find / -xdev -perm -0002 \( -type f -o -type d ! -perm -1000 \)`) | 5,044, in 0.07 s |
| The same with `-exec chmod o-w -- {} +` | 4.9 s; none left after |

This proves the command, and lets the other plan's tests run against these permissions. Its time says nothing about GitHub's:

- The image holds Ubuntu's base and Node.js; GitHub's holds its whole tool cache, Android's SDK and more under `/usr/local` and `/opt`.
- The container's root is overlayfs: `chmod` copies each file up, while on the VM's ext4 it changes only metadata.

`catthehacker/ubuntu:full-24.04` is a copy of a GitHub runner's file system, image `20260907.300.1`, 18.97 GB compressed, with GitHub's `PATH` and uid 1001 ([image](../web/catthehacker/ghcr-io-catthehacker-ubuntu-act-latest-runner-24-04-and-full-24-04.md)). Run there, the walk without `-exec` gives GitHub's count of entries, and close to its listing time, given the disk. `chmod`'s time stays pessimistic on overlayfs. Using that image is a third-party image to audit, for the other plan to decide; a CI run on its branch stays the exact measure.

## Decisions

Answered on 2026-10-19: 1a, 2b and 3a. The responsible person asked for a local environment that reproduces GitHub Actions, to choose among actions/runner, local-action and act, and to commit the Docker configuration for reuse. The audit chose a plain image with `docker run`.

1. **The tooling.**
   - a) A Dockerfile and a script around `docker run`; no new tool.
   - b) a), plus act, upgraded to 0.2.89 with `brew upgrade act`, and a script that runs a workflow's job on the image with the flags of the prototype.
   - c) b) with act's default image, `catthehacker/ubuntu:act-latest`.

   b) runs `ci.yml` as a workflow, which a) cannot. But act changes what matters here: the workspace's path, `RUNNER_TEMP`, the Docker socket, and the cache server, each by a flag. And Codeman's agent job prints the agent's output: an act older than 0.2.86 would act on an `::add-path::` in it. c) runs as root, without the image's permissions or `PATH`.

   **Recommendation: a).** It reproduces everything the sandbox depends on, with inputs already pinned and audited. Decide on act when a task needs a workflow run locally; the upgrade is its own decision.
2. **How a developer runs it.**
   - a) `scripts/runner.sh [command]` only.
   - b) a), and an npm script, `"test:runner": "sh scripts/runner.sh"`, listed in [scripts](../development/guide.md#scripts).

   **Recommendation: b).** `npm run test:runner` runs CI's tests on the image, and `npm run test:runner -- <command>` anything else.
3. **When to commit.** The image and its page show which paths the agent can write on `ubuntu-latest`, and the page cites the other plan's `docs/web/` pages, not committed yet, and its tool, `docs/web/tools/github-repositories.md`.
   - a) Build and use it now, uncommitted; commit it with the other plan's fix, or after.
   - b) Commit it now, without the other plan's pages, and without saying why the permissions matter.

   **Recommendation: a).** It follows the other plan's caution, and the other plan can test its fix in it before anything is pushed.

## Steps

Assuming decisions 1a, 2b and 3a. Each step is one commit. A step is done when `npm run check` passes on the host, and what it names below holds.

### 1. Record the audit

**Done on 2026-10-19** in `862e30f`. The audit's commit also holds the runner image pages of the [plan for the agent job's programs](2026-10-19-resolve-privileged-tools-outside-the-agents-reach.md), which this image cites.

- Commit the pages this audit recorded: `docs/web/nektos/`, `docs/web/catthehacker/`, `docs/web/homebrew/`, `docs/web/github/local-action-readme-md-at-afcb88e.md`, `runner-readme-md-at-197ca02.md`, `github-hosted-runners-reference.md`, `adding-self-hosted-runners.md`, `docs/web/docker-hub/ubuntu-noble-20260930-1.md`, and the tools `github-container-registry.md`, `github-security-advisories.md` and `homebrew.md`.
- In [dependencies](../development/dependencies.md):
  - an inventory row, "The local runner image", kind "Image, Codeman's own, local only", pinned by digest, with its inputs: `ubuntu:noble-20260930.1`, `node:24.21.0-bookworm-slim`, and `ca-certificates`, `git`, `sudo`, `procps`, `unzip` from Ubuntu's archive, unpinned, checked by apt's signed indexes;
  - a section for it: what, why, inputs, permissions (the working tree read-only, the network, no Docker socket), and that Docker Desktop's terms apply;
  - an audit-log row: act, the runner and local-action, not adopted, with this plan.

Done when: `src/webdocs.test.ts` and `src/docs.test.ts` pass with the pages.

Commit message: `Record the audit of tools to run Actions locally`.

### 2. Add the runner image and its script

**Done on 2026-10-19** in `329d1e3`. `npm run test:runner` gives 640 tests, 0 failed, with every sandbox test passed; `npm run check` passes on the host.

- `docker/runner/Dockerfile`: the prototype's, with a comment at the top naming `docs/development/local-actions.md`.
- `scripts/runner.sh`: the prototype's, without `CODEMAN_TREE`. It builds `codeman-runner:local` from `docker/runner/`, copies the working tree without `node_modules` into `/home/runner/work/codeman/codeman`, runs `npm ci`, then the command, `npm test` by default, with `CODEMAN_SANDBOX_TEST=1` and `--init`.
- `package.json`: `"test:runner": "sh scripts/runner.sh"`.
- `docs/development/local-actions.md`, new: what the image reproduces and from which source; how to run it; what differs from GitHub's runner (the table under [how far it is](#how-far-it-is-from-githubs-runner)); how to update its inputs; why `--init`.
- [`docs/development/guide.md`](../development/guide.md): `npm run test:runner` in [scripts](../development/guide.md#scripts); in [tests](../development/guide.md#tests), the sandbox test also runs with it; `docker/runner/` and `scripts/runner.sh` in "Outside src/".
- [`docs/README.md`](../README.md): a row under "Contribute": "Run Actions locally | Run the tests that need GitHub's runner, on your machine".

Done when, from a clean clone:

1. `npm run test:runner` prints `fail 0`, with the 3 sandbox tests passed, not skipped.
2. `npm run test:runner -- sh -c 'id -u; sudo -n true && echo sudo; stat -c "%a %n" /opt /opt/pipx_bin /usr/share /usr/local/bin; echo "$PATH"'` prints `1001`, `sudo`, four `777` lines and the `PATH` of the Dockerfile.
3. `git status` on the host shows no change after both.

Commit message: `Add a local runner image for the tests that need ubuntu-latest`.

Body: The sandbox tests need Linux, a runner user with sudo, and the image's permissions and PATH. Only CI had them; this image reproduces them, so they run before a push.

### 3. Close the plan

**Done on 2026-10-19.** The [plan for the agent job's programs](2026-10-19-resolve-privileged-tools-outside-the-agents-reach.md) was tested on this image before anything was pushed.

Set this plan to `completed`.

Commit message: `Complete the plan for running Actions locally`.

## How far it is from GitHub's runner

| | GitHub's `ubuntu-latest` | The local image |
| --- | --- | --- |
| Machine | A VM per job, Azure's kernel, systemd | A container on Docker Desktop's kernel, `tini` as PID 1, no systemd: `loginctl`, lingering and user services cannot be tested |
| Root file system | ext4 | overlayfs; other mounts (`/etc/hosts`, `/etc/resolv.conf`) change where `-xdev` stops |
| `runner` | uid 1001, passwordless `sudo`; its groups and the exact `sudoers` rule not checked | uid 1001, group 1001, `NOPASSWD:ALL` in `/etc/sudoers.d/runner`, Ubuntu's `secure_path`. The base image's `ubuntu` user, uid 1000, stays |
| Permissions | The build scripts' `777` trees, and whatever else the image leaves open, not checked | Only the build scripts' trees |
| `PATH` | Issue 11414's, plus setup actions' entries | The same, with setup-node's entry; x64 only |
| Software | Thousands of tools; git from a PPA; Node in `/usr/local/bin` too; Docker, cron, at | Ubuntu's base, Node.js 24.21.0, git 2.43.0, `sudo`, `procps`, `unzip` |
| Docker | A socket the runner's group can use | No socket: the sandbox test's Docker check passes trivially |
| Architecture | x64; `ubuntu-24.04-arm` for arm64 | The host's; arm64 needs `--platform` and is not tested |

## Out of scope

- act, and any upgrade of it (decision 1).
- Running the templates' jobs locally: they need the GitHub App, OIDC and GitHub's API.
- Changing CI, or publishing the image: CI keeps running on GitHub's runner.
- Committing the escape's scratch test: the other plan's step 1 adds its own.
- Changing the other plan. How it can measure the walk here is in [measuring the walk](#measuring-the-walk), for its review.
- arm64, and the `PATH` of `ubuntu-24.04-arm`.
