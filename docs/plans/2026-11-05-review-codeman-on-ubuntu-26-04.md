---
status: pending
created_at: 2026-11-05T16:50:00-03:00
updated_at: 2026-11-05T16:50:00-03:00
commit: 4d89540
---

# Review Codeman on Ubuntu 26.04

## Goal

Codeman's templates, CI and e2e suite move from `ubuntu-24.04` to Ubuntu 26.04 only after its sandbox has been reviewed there, as it was on Ubuntu 24.04.

## Context

- GitHub moves the `ubuntu-latest` label to Ubuntu 26.04 between 2026-10-19 and 2026-11-19 ([announcement](https://github.com/actions/runner-images/issues/14748)). Among other changes, systemd goes from 255 to 259, and the kernel from 6.17 to 7.0.
- On 2026-11-05, a pull request's CI failed on one test, `the agent cannot run a command outside its jail through the system's services` in [`src/sandbox.test.ts`](../../src/sandbox.test.ts). It found an abstract Unix socket it has not reviewed, owned by `systemd-udevd`. Every other test of the sandbox passed. The run's log needs a login, so the image is inferred from the socket, below; the job's "Set up job" step names it.
- Codeman's sandbox was reviewed against Ubuntu 24.04's packages: `sudo`, AppArmor's user namespace rule, `bwrap`, `setpriv` and `unshare`, polkit's login1 policy, and where each program lives ([`docs/web/ubuntu/`](../web/ubuntu/), the [jail plan](2026-10-19-jail-the-agent-in-a-read-only-mount-namespace.md), the [privileged tools plan](2026-10-19-resolve-privileged-tools-outside-the-agents-reach.md)).
- So the templates, CI and the e2e workflow were pinned to `ubuntu-24.04` the same day, with a test that keeps them there ([`src/templates.test.ts`](../../src/templates.test.ts)). Installations whose templates still say `ubuntu-latest` run on Ubuntu 26.04 once GitHub's move reaches them ([upgrading](../installation/upgrading.md#runner-label-pinned)).
- The local runner image ([`docker/runner/Dockerfile`](../../docker/runner/Dockerfile)) and the e2e suite's job image are built on Ubuntu 24.04.

### What is known about the failing socket

Read from systemd's sources at the tags `v255` and `v259`, not yet saved under `docs/web/` (step 1):

- In 255, `systemd-udevd` talks to its workers through a `socketpair`, which has no name.
- In 259, it binds a datagram socket named `@` and a random 64-bit number (`socket_autobind` in `src/basic/socket-util.c`, called by `notify_socket_prepare` in `src/shared/notify-recv.c`), with `SO_PASSCRED`. The failing socket, `@18199374096224220369`, has that form.
- `on_worker_notify` in `src/udev/udev-manager.c` looks up the sender by the process the kernel reports, and ignores a datagram from any process that is not one of its workers.

The agent cannot pass for a worker, since a user that is not root cannot claim another process in its credentials. So the socket looks harmless, but its name changes on every boot, and other programs could bind names of the same form (decision 2).

## Decisions

1. **Which label the templates move to.**
   - `ubuntu-26.04` (recommended): each move to a new Ubuntu is reviewed first, as this one.
   - `ubuntu-latest`: follows GitHub, with no review before the next move.
2. **How the sandbox test accepts a socket whose name is random.**
   - By its owner and its name's form together, read from `ss -xlpn` as root (recommended): a numeric name from another program still fails.
   - By its name's form alone: simpler, and accepts any program's numeric name.
3. **Whether CI runs on both images until the move.**
   - A second CI job on `ubuntu-26.04` while the review lasts (recommended): free, and it shows each difference.
   - Only by hand, on a branch, during the review.

## Steps

1. **Save the sources.** The announcement, the Ubuntu 26.04 runner image's README, systemd's three files above at the version of Ubuntu 26.04's package, and the Ubuntu 26.04 packages that replace each page in `docs/web/ubuntu/`. Done when the web documentation's tests pass.
2. **Run the unit tests on `ubuntu-26.04`,** by decision 3. Done when the failures are listed here.
3. **Review each difference** against step 1's sources: the `systemd-udevd` socket (decision 2), which `sudo` the image ships and its `secure_path`, AppArmor's rule on user namespaces, `bwrap`, `setpriv` and `unshare`, polkit's login1 policy, where each program Codeman runs lives, and any other service or socket the test finds. Done when the sandbox tests pass on `ubuntu-26.04`, and each change of the test names its source.
4. **The local images on Ubuntu 26.04.** The local runner image and the e2e job image, by digest, with [the image's differences](../development/local-actions.md#how-far-it-is-from-githubs-runner) updated. Done when `scripts/runner.sh` runs the sandbox tests in the new image.
5. **The e2e suite on Ubuntu 26.04,** when the maintainer decides to run it, and where. Done when every scenario passes.
6. **Move,** to decision 1's label: the templates, CI, the e2e workflow and the test that pins them; an entry in [upgrading](../installation/upgrading.md); the docs that name the label. Done when CI passes and the docs tests pass.

## Out of scope

- arm64: `ubuntu-24.04-arm`, and its 26.04 image, stay untested, as now.
- Changing how the sandbox works. If the review finds a hole, it gets its own plan.
- Pods: they run on Runpod and Salad, not on GitHub's runners.
