#!/bin/sh
# Runs a command in a local stand-in for GitHub's ubuntu-latest runner (docker/runner/Dockerfile),
# as `runner`, on a copy of this working tree at the workspace's path. With no command, it runs what
# CI's tests run: `npm ci`, then `npm test` with the sandbox test.
# See docs/development/local-actions.md.
#
#   npm run test:runner                       # npm ci, then npm test with CODEMAN_SANDBOX_TEST=1
#   npm run test:runner -- node --test src/sandbox.test.ts
#   npm run test:runner -- bash               # a shell, after npm ci
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
image=codeman-runner:local
workspace=/home/runner/work/codeman/codeman

docker build --quiet --tag "$image" "$root/docker/runner" >/dev/null

if [ "$#" -eq 0 ]; then set -- npm test; fi
tty=""
if [ -t 0 ] && [ -t 1 ]; then tty="--tty --interactive"; fi

# The working tree is mounted read-only and copied, without node_modules: the container installs
# its own, for Linux, and changes nothing on the host.
# --init reaps orphans, as the VM's systemd does: without it, a killed agent process stays a zombie
# that pgrep still lists, and the sandbox's seal refuses to collect.
# The agent's jail needs root to create namespaces and mount, which Docker denies by default:
# SYS_ADMIN, and no seccomp or AppArmor profile, which block unshare and mount. GitHub's VM needs none.
# shellcheck disable=SC2086
exec docker run --rm --init $tty \
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --volume "$root:/mnt/codeman:ro" \
  --env CODEMAN_SANDBOX_TEST=1 \
  "$image" \
  bash -c '
    set -eu
    mkdir -p "$0"
    tar -C /mnt/codeman --exclude=./node_modules -cf - . | tar -C "$0" -xf -
    cd "$0"
    npm ci --no-audit --no-fund >/dev/null
    exec "$@"
  ' "$workspace" "$@"
