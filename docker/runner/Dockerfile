# A local stand-in for GitHub's ubuntu-26.04 runner: only what Codeman's runner-dependent code
# sees there. The user `runner` (uid 1001) with passwordless sudo, Node.js where setup-node puts it,
# the image's world-writable trees, and the job's PATH in GitHub's order.
# See docs/development/local-actions.md.
# Every input is pinned by digest; apt packages come from Ubuntu's signed archive.
# GitHub's sources are runner-images at 3556d77, the commit of image 20261116.202.1
# (docs/web/github/runner-images-*-at-3556d77.md).

# Only Node.js's files are used: the version pods download (NODE_RELEASE, src/inference/images.ts).
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node

# The templates, CI and the e2e workflow run on ubuntu-26.04
# (docs/plans/2026-11-05-review-codeman-on-ubuntu-26-04.md).
FROM ubuntu:resolute-20261105.1@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db

ARG NODE_VERSION=24.22.1
ENV DEBIAN_FRONTEND=noninteractive

# What Codeman's agent job runs (docs/plans/2026-10-19-resolve-privileged-tools-outside-the-agents-reach.md,
# context 1), from Ubuntu's packages. cron, at and systemd are left out: Codeman's cleanup of them is
# best-effort, and skipped where they are missing. As on the runner:
# - /usr/bin/sudo is sudo-rs: the runner has both `sudo` and `sudo-rs`, and sudo-rs's alternative
#   wins, 50 to 40 (docs/web/ubuntu/usr-lib-cargo-bin-sudo-in-sudo-rs-0-2-13-0ubuntu1-2-amd64-deb.md).
#   `sudo` alone, without its recommends, would leave /usr/bin/sudo to sudo 1.9.17p2;
# - cp is GNU's and dd uutils': the base's coreutils-from-uutils links cp, mv, rm, df and true to GNU's,
#   and the rest to uutils (docs/web/ubuntu/coreutils-from-0-0-0-ubuntu25-source-package.md);
# - bwrap, which the runner has through other packages, not its toolset's apt list.
# The checks fail the build if a package changes this mix.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git sudo sudo-rs bubblewrap procps unzip \
 && rm -rf /var/lib/apt/lists/* \
 && test "$(readlink -f /usr/bin/sudo)" = /usr/lib/cargo/bin/sudo \
 && test "$(readlink -f /usr/bin/cp)" = /usr/bin/gnucp \
 && test "$(readlink -f /usr/bin/dd)" = /usr/lib/cargo/bin/coreutils/dd

# The runner's user, as on GitHub: uid 1001, passwordless sudo.
RUN useradd --uid 1001 --create-home --shell /bin/bash runner \
 && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner \
 && chmod 0440 /etc/sudoers.d/runner

# Node.js in the tool cache, where actions/setup-node finds a cached version, marked complete.
COPY --from=node /usr/local/bin/node /opt/hostedtoolcache/node/${NODE_VERSION}/x64/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /opt/hostedtoolcache/node/${NODE_VERSION}/x64/lib/node_modules/npm
RUN cd /opt/hostedtoolcache/node/${NODE_VERSION}/x64/bin \
 && ln -s ../lib/node_modules/npm/bin/npm-cli.js npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js npx \
 && touch /opt/hostedtoolcache/node/${NODE_VERSION}/x64.complete

# The image's permissions, set last as GitHub's build does:
# - /usr/share and /opt, recursively (configure-system.sh:13,15), so the tool cache and /opt/pipx_bin;
# - /usr/local/bin and /usr/local/lib/node_modules, recursively (install-nodejs.sh:24-25);
# - /usr/local/.ghcup, recursively, x64 only (install-haskell.sh:38).
RUN mkdir -p /opt/pipx_bin /opt/pipx /usr/local/lib/node_modules /usr/local/.ghcup/bin \
 && chmod -R 777 /usr/share /opt /usr/local/bin /usr/local/lib/node_modules /usr/local/.ghcup

# The tool cache (configure-environment.sh:42-45), pipx's directories (install-python.sh:42-43),
# and ImageOS, the build's image_os for Ubuntu 26.04 on x64 (locals.ubuntu.pkr.hcl).
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache \
    PIPX_BIN_DIR=/opt/pipx_bin \
    PIPX_HOME=/opt/pipx \
    ImageOS=ubuntu26
# The job's PATH on x64 with no setup action, after setup-node prepends its tool-cache directory, as
# CI's job does. As ubuntu-24.04's (issue 11414): build.ubuntu-26_04.pkr.hcl runs the same scripts
# that prepend to it, in the same order, on the base's same /etc/environment.
ENV PATH=/opt/hostedtoolcache/node/${NODE_VERSION}/x64/bin:/snap/bin:/home/runner/.local/bin:/opt/pipx_bin:/home/runner/.cargo/bin:/home/runner/.config/composer/vendor/bin:/usr/local/.ghcup/bin:/home/runner/.dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin

USER runner
WORKDIR /home/runner/work
RUN mkdir -p /home/runner/work/_temp && node --version && npm --version && git --version && sudo -n true
