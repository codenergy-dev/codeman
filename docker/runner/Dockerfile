# A local stand-in for GitHub's ubuntu-latest runner: only what Codeman's runner-dependent code
# sees there. The user `runner` (uid 1001) with passwordless sudo, Node.js where setup-node puts it,
# the image's world-writable trees, and the job's PATH in GitHub's order.
# See docs/development/local-actions.md.
# Every input is pinned by digest; apt packages come from Ubuntu's signed archive.

# Only Node.js's files are used: the version of the pod images.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# ubuntu-latest is Ubuntu 24.04 (docs/web/github/runner-images-readme-md-at-82d1b86.md).
FROM ubuntu:noble-20260930.1@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

ARG NODE_VERSION=24.21.0
ENV DEBIAN_FRONTEND=noninteractive

# What Codeman's agent job runs (docs/plans/2026-10-19-resolve-privileged-tools-outside-the-agents-reach.md,
# context 1), from Ubuntu's packages. cron, at and systemd are left out: Codeman's cleanup of them is
# best-effort, and skipped where they are missing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git sudo procps unzip \
 && rm -rf /var/lib/apt/lists/*

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

ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache \
    PIPX_BIN_DIR=/opt/pipx_bin \
    PIPX_HOME=/opt/pipx \
    ImageOS=ubuntu24
# The job's PATH on ubuntu-24.04 x64 with no setup action (issue 11414), after setup-node prepends
# its tool-cache directory, as CI's job does.
ENV PATH=/opt/hostedtoolcache/node/${NODE_VERSION}/x64/bin:/snap/bin:/home/runner/.local/bin:/opt/pipx_bin:/home/runner/.cargo/bin:/home/runner/.config/composer/vendor/bin:/usr/local/.ghcup/bin:/home/runner/.dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin

USER runner
WORKDIR /home/runner/work
RUN mkdir -p /home/runner/work/_temp && node --version && npm --version && git --version && sudo -n true
