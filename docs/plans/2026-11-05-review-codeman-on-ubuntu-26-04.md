---
status: in progress
created_at: 2026-11-05T16:50:00-03:00
updated_at: 2026-11-25T15:00:00-03:00
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

Answered by the maintainer on 2026-11-24: each as its recommendation. The templates move to `ubuntu-26.04`; the sandbox test accepts the random socket by its owner and its name's form together; CI runs a second job on `ubuntu-26.04` while the review lasts.

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

## Progress

On the branch `features/ubuntu-26-04`, from `main` at `0f9bb8c`, merged through pull request #4 on 2026-11-24, with the sandbox fix of pull request #5. Step 3 goes on in a new branch from `main`.

- **Step 1, done.** The sources are saved:
  - the [announcement](../web/github/ubuntu-ubuntu-latest-label-will-use-ubuntu-26-04-in-november-2026.md), and the image's [README at e015a08](../web/github/runner-images-ubuntu2604-readme-md-at-e015a08.md): image 20261116.202.1, kernel 7.0.0-1020-azure, systemd 259.9-0ubuntu0.1;
  - systemd's three files, in the [systemd_259.9-0ubuntu0.1 source package](../web/ubuntu/systemd-259-9-0ubuntu0-1-source-package.md), the version the README names;
  - Ubuntu 26.04's pages beside each page of 24.04's in `docs/web/ubuntu/`: the [Contents index](../web/ubuntu/dists-resolute-contents-amd64-gz.md), [`/etc/sudoers`](../web/ubuntu/etc-sudoers-in-sudo-common-1-2ubuntu-all-deb.md) and [sudo-rs](../web/ubuntu/usr-lib-cargo-bin-sudo-in-sudo-rs-0-2-13-0ubuntu1-2-amd64-deb.md), AppArmor's [unprivileged_userns](../web/ubuntu/etc-apparmor-d-unprivileged-userns-in-apparmor-5-0-2-0ubuntu1-26-04-1-amd64-deb.md) and [bwrap-userns-restrict](../web/ubuntu/etc-apparmor-d-bwrap-userns-restrict-in-apparmor-5-0-2-0ubuntu1-26-04-1-amd64-de.md), [bwrap](../web/ubuntu/usr-bin-bwrap-in-bubblewrap-0-11-1-1ubuntu0-3-amd64-deb.md) with its [changelog](../web/ubuntu/usr-share-doc-bubblewrap-changelog-debian-gz-in-bubblewrap-0-11-1-1ubuntu0-3-amd.md) and [manual](../web/ubuntu/usr-share-man-man1-bwrap-1-gz-in-bubblewrap-0-11-1-1ubuntu0-3-amd64-deb.md), [setpriv](../web/ubuntu/usr-share-man-man1-setpriv-1-gz-in-util-linux-2-41-3-3ubuntu2-2-amd64-deb.md) and [unshare](../web/ubuntu/usr-share-man-man1-unshare-1-gz-in-util-linux-2-41-3-3ubuntu2-2-amd64-deb.md), [polkit's login1 policy](../web/ubuntu/usr-share-polkit-1-actions-org-freedesktop-login1-policy-in-systemd-259-9-0ubunt.md), [multipath-tools](../web/ubuntu/multipath-tools-0-14-3-2ubuntu1-source-package.md) and [open-iscsi](../web/ubuntu/open-iscsi-2-1-11-3ubuntu3-1-source-package.md). arm64's index is left out, as arm64 is out of scope.
- **Decision 3, done.** `.github/workflows/ci.yml` has a second job, `check-ubuntu-26-04`, with `check`'s steps on `ubuntu-26.04`, and `src/templates.test.ts` checks that both jobs' steps are equal, and that the templates and the e2e workflow stay on `ubuntu-24.04`.
- **Step 3, the socket (decision 2).** The sandbox test accepts an abstract socket named `@` and up to 20 digits only when every process that holds it, by `ss -xlpn` as root, is `systemd-udevd`, citing the systemd page; a unit test covers the rule. The 24.04 sockets keep their entries, with both versions' pages.

What the sources show, which the first CI run on `ubuntu-26.04` must confirm or answer (step 2):

| Difference | From the sources | What CI must show |
| --- | --- | --- |
| `sudo` | No package installs `/usr/bin/sudo`: `sudo` and `sudo-rs` each register it as an alternative, and, when both are installed, `sudo-rs` wins with priority 50 against 40. `sudo-rs` keeps `secure_path` and `@includedir`, and cannot turn `env_reset` off. `/etc/sudoers` moved to `sudo-common`, with the same `secure_path`, plus `use_pty` | Which `sudo` the runner runs, and whether the sandbox's `sudo -n` calls behave the same |
| coreutils | The `coreutils` package pre-depends on `coreutils-from-uutils` or `coreutils-from-gnu`: by default, the Rust uutils provide `chmod`, `chown`, `cp`, `install`, `mkdir`, `realpath`, `rm` and the rest Codeman runs | Whether the runner has the uutils or GNU's, and whether the options the sandbox passes behave the same |
| AppArmor and `bwrap` | `unprivileged_userns` is unchanged, but the new profile `bwrap-userns-restrict` lets `/usr/bin/bwrap` create user namespaces and mount inside them, its children without capabilities | Whether the profile is loaded, and whether the agent can then run `bwrap` to build namespaces of its own inside the jail, and what that reaches. If it reaches anything the jail hides, it gets its own plan (out of scope here) |
| `bwrap` | 0.11.1, still without the fix for CVE-2026-87766; the options Codeman uses read the same | Nothing new beyond the row above |
| `setpriv`, `unshare` | util-linux 2.41.3; the options Codeman uses read the same | Nothing new |
| polkit's login1 | `set-self-linger` still `yes` for any user | The test's lingering route stays closed |
| Sockets | `systemd-udevd`'s random one, now accepted by its owner. `systemd-homed`, `systemd-importd` and `systemd-sysupdated` bind names of the same form, and stay unreviewed. multipathd also listens on `/run/multipathd.socket`, a path, not an abstract name | Any other abstract socket the test lists |
| Where programs live | The [Contents index](../web/ubuntu/dists-resolute-contents-amd64-gz.md) lists each program under `usr/` only, as on 24.04 | That `programs come only from trusted directories` still passes |

- **Step 2, first runs (2026-11-24).** CI failed on four sandbox tests, the same on this branch and on `fixes/undici-6-29-1`, whose only job, `check`, runs on `ubuntu-24.04` and whose change is the lockfile alone. So this failure is not 26.04's alone; `ubuntu-24.04`'s image changed too:
  - `the agent is contained and its changes are collected safely`, `the agent cannot plant programs that run outside its jail` and `the agent cannot run a command outside its jail through the system's services` end with exit code 32, not 0.
  - `the agent stops when its run does, with the reason` has no reason, because the jail had already exited.
  - Each fits the jail's setup failing before the agent starts: it runs with `set -e`, and 32 is what `mount` returns when a mount fails. Which mount is not in the log: the jail's output goes to the run's log, which the tests did not print. The tests now print it when the agent's run fails (`assertRan` in [`src/sandbox.test.ts`](../../src/sandbox.test.ts)).
- **Step 2, second run (`c1033f1`).** `check-ubuntu-26-04` passed every test, on image 20261116.202.1. `check` failed the same four, on `ubuntu-24.04` image 20261116.133.1, and the jail's log named the mount: "mount: /snap/core22/2987: filesystem was mounted, but any subsequent operation failed: Read-only file system."
  - The cause, from [util-linux's source](../web/ubuntu/util-linux-2-39-3-9ubuntu6-6-source-package.md): a snap's mount has userspace options, which libmount records in `/run/mount/utab`, and rewrites after a remount. The jail had already made `/run` read-only, so the write failed and `mount` exited with 32.
  - Reproduced in the local runner image with a mount that has `x-gdu.hide`: the sandbox tests fail with the same message, and pass with `mount -n`.
  - The fix, `e98d12c`: every mount of the jail runs with `-n`. It reached `main` through pull request #5, and this branch merged `main`.

- **Step 3, on the branch `features/ubuntu-26-04-review`, from `main` at `042d98c`.** Two sandbox tests answer the table's questions on both runners:
  - `the agent cannot undo its jail from a user namespace`: as the agent, in the jail, `unshare` and `bwrap` each try to create a user namespace, to unmount the jail's tmpfs over `/tmp` and `/run/dbus`, and to make `/usr/local/bin` writable again. It passes when the runner's `/tmp` and system bus stay hidden and nothing is written; each route's result is printed. In the local runner image, which loads no AppArmor profile, `unshare` creates the namespace, and the jail's mounts stay locked: `/tmp` stays the jail's, and the remount fails with 32. That image has no `bwrap`.
  - `the runner's sudo, coreutils and AppArmor are reported`: which `sudo`, `cp` and `bwrap` the runner has and their versions, `kernel.apparmor_restrict_unprivileged_userns`, and the AppArmor profiles loaded for user namespaces.

- **Step 3, the first run of these tests (`b4d9cb4`).** Every test passes on both jobs: `check` on `ubuntu-24.04` and `check-ubuntu-26-04`. What the runners showed, row by row of the table above:

  | Difference | `ubuntu-24.04` | `ubuntu-26.04` |
  | --- | --- | --- |
  | `sudo` | sudo 1.9.15p5 | sudo-rs 0.2.13, `/usr/bin/sudo` linking to `/usr/lib/cargo/bin/sudo`. The sandbox's `sudo -n` calls behave the same: every sandbox test passes |
  | coreutils | GNU 9.4 | `cp` is GNU 9.7 (`/usr/bin/gnucp`); `dd` is not GNU's, so the unit test of the live read skipped. The sandbox test reads live files through it and passes: a link and a pipe are refused, without blocking, and the limit holds. The unit test now accepts uutils' `dd`, and the report names `dd` |
  | AppArmor | `kernel.apparmor_restrict_unprivileged_userns` 1; `unprivileged_userns` enforced | The same, plus `bwrap` and `unpriv_bwrap` enforced |
  | User namespaces, from the jail | `unshare` refused (writing `uid_map`); no `bwrap` | `unshare` refused the same way. `bwrap` creates one, and the jail holds: unmounting its `/tmp` reveals nothing, and `/usr/local/bin` bound again stays read-only ("Read-only file system") |
  | `setpriv`, `unshare` | Unchanged | Unchanged: every sandbox test passes |
  | polkit's login1 | The system bus is hidden | The same: `systemd-run` and `loginctl` find no bus |
  | Sockets | `multipathd`'s and `iscsid`'s | The same, plus `systemd-udevd`'s random one, accepted by its owner |
  | Where programs live | `programs come only from trusted directories` passes | The same |

- **Step 3, done (`3c6f722`).** Both jobs pass every test. On `ubuntu-26.04`, `dd` is uutils' 0.10.0 (`/usr/lib/cargo/bin/coreutils/dd`), and the live read's unit test passes with it; `ubuntu-24.04`'s is GNU's 9.4. The other rows read as in the run before.

Next: step 4, the local images on Ubuntu 26.04. Their `cp` and `dd` should match the runner's mix, GNU's `cp` and uutils' `dd`, and their `sudo` be sudo-rs.
