---
status: completed
created_at: 2026-10-19T13:42:29-03:00
updated_at: 2026-10-19T21:53:18-03:00
commit: db04a9c
---

# Resolve privileged tools outside the agent's reach

> [!WARNING]
> Security work. This plan describes a sandbox escape that, by the sources below, works on `ubuntu-latest` with the templates as they are. The repository is public: commit this plan with the fix, or after it, not before.

## Goal

The agent cannot plant a program that runs outside the sandbox. Codeman's step runs every program by a path only root can change, and the job's later steps find nothing on their `PATH` that `codeman-agent` could write. The sandbox's guarantee then no longer depends on which directories the runner image and the setup actions put on the `PATH`.

## Context

Decision 7 of the [plan to correct the docs](2026-10-16-correct-the-docs-against-the-code.md) approved option 7a: investigate a possible escape through `PATH` in a security plan of its own. This is that plan.

The docs say the agent cannot read the runner's processes, so it cannot reach the job's tokens or the secrets of other steps ([agent sandbox](../runs/agent.md#agent-sandbox), [secrets](../security/secrets.md)). That holds only if nothing running as the runner's user, or as root, runs a file the agent could change.

### 1. The programs the agent job runs

The agent runs from the first harness run (`src/steps/agent.ts:138`) to the seal (`src/steps/agent.ts:179`). Any program looked up by name after the agent started can be one it planted.

| Where | Program | Found by | Runs as | When |
| --- | --- | --- | --- | --- |
| `src/sandbox.ts:18,26` (`sudoCapture`, `sudo`) | `sudo` | Name, in the job's `PATH` | The runner's user | Before, between and after the harness runs |
| Every `sudo([...])` and `sudoCapture([...])` | `useradd`, `chown`, `chmod`, `install`, `rm`, `cp`, `test`, `git`, `realpath` | Name, by `sudo`: its `secure_path`, or else the caller's `PATH` | root | Before and after |
| `src/sandbox.ts:42` | `id` | Name | The runner's user | Before |
| `src/sandbox.ts:75-76` | `mkdir`, `tee` | Name, by `sudo` | `codeman-agent` | Before |
| `src/sandbox.ts:81,110` | `sudo`, then `pkill`, `pgrep` | Names | The runner's user, then root | During (a timer, `sandbox.ts:211`) and after |
| `src/sandbox.ts:86` (`trySudo`) | `sudo`, then `crontab`, `loginctl`, `usermod` | Names | root | After |
| `src/sandbox.ts:101` | `bash`, then `atq`, `awk`, `xargs`, `atrm` | Names | `codeman-agent` | After |
| `src/sandbox.ts:111` | `sleep` | Name | The runner's user | After |
| `src/sandbox.ts:199` | `sudo`, then `/bin/bash` | Name, then absolute | The runner's user, then `codeman-agent` | Each harness run, the fix pass included |
| `src/collect.ts:57,93` | `git` | Name, by `sudo` | root | After |
| `src/collect.ts:159-162,199-202` | `/usr/bin/env`, then `find`, `cp` | Absolute, then a name that `env` looks up in `sudo`'s `PATH` | root | After |
| `src/collect.ts:254-256` | `sudo`, then `/bin/sh`, then `dd` | Name, absolute, then name | The runner's user, then `codeman-agent` | Between the harness runs |
| `src/collect.ts:272-283` | `realpath`, `test`, `cp`, `chown` | Names, by `sudo` | root | After |
| `src/results.ts:95,99` | `unzip` | Name | The runner's user | Before |
| `src/harness/opencode.ts:102` | `tar` | Name | The runner's user | Before |
| After Codeman's step: `actions/upload-artifact`, then the post steps of the two `actions/checkout` and of any setup action | `git` for checkout ([`git-command-manager.ts:676`](../web/github/checkout-src-git-command-manager-ts-at-3d3c42e.md)), via its post step ([`main.ts:46`](../web/github/checkout-src-main-ts-at-3d3c42e.md), [`git-source-provider.ts:340`](../web/github/checkout-src-git-source-provider-ts-at-3d3c42e.md)) | Name, in the job's `PATH` | The runner's user | After |

What runs as `codeman-agent` gains the agent nothing. Everything else does: the runner's user can read `/proc/<pid>/environ` of Codeman's step, which holds its inputs (the key encryption secret, the Serverless key, the job's token), and it has `sudo`.

`sudo` itself finds a command in its `secure_path` when one is set. Ubuntu 24.04's default is `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin` ([`/etc/sudoers`](../web/ubuntu/etc-sudoers-in-sudo-1-9-15p5-3ubuntu5-24-04-4-amd64-deb.md)). Either way, `/usr/local/bin` comes before `/usr/bin`.

### 2. What `codeman-agent` can write

Codeman closes the runner's home (`src/sandbox.ts:48`) and leaves everything else as the image has it. GitHub's Ubuntu images make whole trees writable by every user, after installing their tools:

| Path | Mode set at build | Source |
| --- | --- | --- |
| `/opt`, recursively: the tool cache `/opt/hostedtoolcache` and `/opt/pipx_bin` | `777` | [`configure-system.sh:15`](../web/github/runner-images-configure-system-sh-at-82d1b86.md), run after the tool cache is filled ([x64 template](../web/github/runner-images-build-ubuntu-24-04-pkr-hcl-at-82d1b86.md) line 223, [arm64](../web/github/runner-images-build-ubuntu-24-04-arm64-pkr-hcl-at-82d1b86.md) line 214); [`configure-environment.sh:44`](../web/github/runner-images-configure-environment-sh-at-82d1b86.md) |
| `/usr/share`, recursively | `777` | [`configure-system.sh:13`](../web/github/runner-images-configure-system-sh-at-82d1b86.md) |
| `/usr/local/bin` and `/usr/local/lib/node_modules`, recursively | `777` | [`install-nodejs.sh:24-25`](../web/github/runner-images-install-nodejs-sh-at-82d1b86.md), on both architectures |
| `/usr/local/.ghcup`, recursively (x64 only) | `777` | [`install-haskell.sh:38`](../web/github/runner-images-install-haskell-sh-at-82d1b86.md) |

Only the Ruby directories of the tool cache get the sticky bit (`configure-system.sh:18`). Without it, the agent can also rename a directory that a setup action downloads into the tool cache during the job, and put its own in its place.

On a live image of August 2026, a file in `/usr/local/bin` was `-rwxrwxrwx root:root` and shadowed the real program in `/usr/bin` ([issue 14516](../web/github/ubuntu-24-04-image-20260804-265-stray-non-setuid-world-writable-usr-local-bin-fu.md)).

### 3. The job's `PATH`

`ubuntu-latest` is Ubuntu 24.04 on x64; `ubuntu-24.04-arm` is its arm64 image ([runner-images README](../web/github/runner-images-readme-md-at-82d1b86.md)). Their `PATH`, with no setup action ([issue 11414](../web/github/path-is-different-on-ubuntu-24-04-arm-compared-to-ubuntu-24-04.md)):

| Entry, in order | Agent can write | Why |
| --- | --- | --- |
| Setup actions' tool-cache directories, prepended ([issue 11409](../web/github/xdg-config-home-path-contain-runneradmin-s-directories-on-the-arm64-linux-runner.md)) | Yes | Under `/opt` |
| `/snap/bin` | Not checked | No build script changes it |
| `/home/runner/.local/bin`, `.cargo/bin`, `.config/composer/vendor/bin`, `.dotnet/tools` | No | The runner's home is closed |
| `/opt/pipx_bin` | Yes | Under `/opt` ([`install-python.sh:25,44`](../web/github/runner-images-install-python-sh-at-82d1b86.md)) |
| `/usr/local/.ghcup/bin` (x64) | Yes | `install-haskell.sh:38` |
| `/usr/local/sbin` | No | No build script changes it |
| `/usr/local/bin` | Yes | `install-nodejs.sh:25` |
| `/usr/sbin`, `/usr/bin`, `/sbin`, `/bin` | No | No build script changes them |

On both architectures, Ubuntu 24.04's packages install every program Codeman runs in `/usr/bin`, except `useradd` and `usermod`, in `/usr/sbin` ([x64](../web/ubuntu/dists-noble-contents-amd64-gz.md), [arm64](../web/ubuntu/dists-noble-contents-arm64-gz.md)). None is in `/usr/local`.

So, with the templates as they are and no setup action, the agent can write `/opt/pipx_bin/sudo`. Codeman's step finds it before `/usr/bin/sudo` at the fix pass or the seal, and runs it as the runner's user. It can also write `/usr/local/bin/git`, which root runs during collection, and which the checkouts' post steps run after Codeman's step.

### Reproduction

A scratch test (outside the repository, on macOS) put a `sudo` script in a directory first on `PATH`, standing for `/opt/pipx_bin` or a tool-cache directory:

1. `sudoCapture(["test", "-d", "/"])` and `sudo(["chown", ...])` returned the script's output, and `killAgentProcesses()` ran it.
2. `statusCommand(...)[0]` is the bare name `git`.
3. `agentPath` keeps the directory in the agent's `PATH`, so the agent shares it with Codeman's step.

The image's side could not be reproduced without a Linux runner; it rests on the sources above.

### Checks at the start

`npm test` passed on 2026-10-19, with other plans' changes in the working tree: 632 tests, 629 pass and 3 skipped.

## Root causes

| # | Root cause |
| --- | --- |
| 1 | Codeman runs its programs by name: `src/sandbox.ts:18,26,42,81,86,110,111,199`, `src/results.ts:95,99`, `src/harness/opencode.ts:102`. Under `sudo`, it names the command too, which root looks up in `secure_path`: every `sudo([...])` call, `src/collect.ts:57` (`git`), and the commands after `/usr/bin/env` at `src/collect.ts:162,202`. |
| 2 | The runner image leaves `/opt`, `/usr/share`, `/usr/local/bin` and `/usr/local/.ghcup` writable by every user, and `src/sandbox.ts:41-49` closes only the runner's home. So the agent can plant a program that the job's later steps find on their `PATH`, such as `git` for `actions/checkout`'s post step. |

## Decisions

Answered by the responsible person on 2026-10-19: 1b and 2a. The fix is tested on the local runner image of the [plan to run GitHub Actions locally](2026-10-19-run-github-actions-locally.md) instead of in CI, before anything is pushed. Its measure of the walk only bounds GitHub's, so the code logs the walk's time, and the first runs on GitHub settle the 60-second threshold.

1. **Where Codeman finds the programs it runs** (root cause 1).
   - a) A fixed absolute path for each, such as `/usr/bin/sudo` and `/usr/sbin/useradd`, failing when the file is not there.
   - b) The first of `/usr/bin`, `/usr/sbin`, `/bin` and `/sbin` that has it, after checking that root owns the file and every directory on the way to it, links followed, and that no other user can write them. It fails, naming the program, when none does.
   - c) A fixed `PATH`, `/usr/sbin:/usr/bin:/sbin:/bin`, for every program Codeman runs. `sudo` still looks its command up in `secure_path`, which starts with `/usr/local/bin`, so each command under `sudo` would need `/usr/bin/env PATH=...` before it. Nothing checks the directories.

   a) is the simplest, but an image that keeps a program in `/bin` only fails. c) keeps names in the code, so a call that skips the wrapper is not visible.

   **Recommendation: b).** It is a) with a fallback for an image that lays programs out otherwise, and it checks what it trusts. One function holds the rule, and a unit test can check every call site.

2. **How the job's later steps stay out of the agent's reach** (root cause 2).
   - a) Before the agent starts, take write access away from other users on every file and directory of the root file system, except directories with the sticky bit, such as `/tmp`: one `find / -xdev ... -perm -0002 ! -perm -1000 -exec chmod o-w` as root. Then check the job's `PATH`, and fail before the agent starts if `codeman-agent` could still add or change a program in one of its directories.
   - b) Only the job's `PATH`: remove others' write access from each of its directories, their parents, and the files directly in them. Then the same check.
   - c) Change nothing, and document that the agent can plant programs that the job's later steps run as the runner's user, which has `sudo`. The sandbox would then no longer protect the job's secrets, which the docs promise.

   Trade-offs:

   | | a) Whole file system | b) `PATH` only | c) Document |
   | --- | --- | --- | --- |
   | Covers programs found by name | Yes | Yes | No |
   | Covers files those programs load, such as a tool's libraries in the tool cache | Yes | No | No |
   | Covers files root services on the VM may run from `/usr/share` or `/opt` (not checked) | Yes | No | No |
   | Time | One walk of the root file system, not measured | A few directories | None |
   | The agent can install into `/usr/local` or the tool cache, as `npm install -g` does | No: it installs in its home | Only outside the `PATH`'s directories | Yes |

   Both a) and b) change the machine's permissions for good. On a GitHub-hosted runner the VM ends with the job; a self-hosted runner would keep them.

   **Recommendation: a).** It is the only option that keeps the guarantee whatever later steps run. Step 2 first measures the walk on `ubuntu-latest` in CI. If it takes more than 60 seconds, this plan goes back for review with the numbers, and b) is the fallback.

## Steps

Each step is one commit: code, tests, `dist/` rebuilt with `npm run build`, and the docs it changes. A step is done when `npm run check` passes, `git status` shows `dist/` in the commit (CI fails when `dist/` differs from the build), and CI's sandbox test passes on `ubuntu-latest` (`CODEMAN_SANDBOX_TEST=1`, `.github/workflows/ci.yml:29`). Running CI needs a pushed branch, which the responsible person authorizes.

Neither step changes the templates, so the [template version](../development/guide.md#template-version) stays.

### 1. Run every program by a path only root can change

**Done on 2026-10-19.** Assuming decision 1b. Where the work differs from the text below:

- `FileStats` has `readdir`, for step 2's check, and no `isDirectory`, which nothing reads. One walk, `walk`, resolves the components for `untrustedReason` and `pathProblems`.
- The check that no program runs by its name also reads `src/steps/agent.ts`.
- The planted scripts of the contained test moved to a test of their own, with step 2 (below): after step 2, the agent can write none of the `PATH`'s directories, so it can no longer plant them itself.

Code, in `src/sandbox.ts`:

- Add:

  ```ts
  /** Where Codeman finds the programs it runs outside the sandbox: on Ubuntu, only root writes here. */
  export const TRUSTED_DIRS = ["/usr/bin", "/usr/sbin", "/bin", "/sbin"];

  /**
   * Why `path` is not trusted, or undefined when it is: root owns the file and every directory on the way
   * to it, links followed, and no other user can write any of them. Pure, for tests.
   */
  export function untrustedReason(path: string, fs: FileStats): string | undefined;

  /** The first `${dir}/${name}` of TRUSTED_DIRS that exists and is trusted; throws, naming `name`, if none. */
  export function findProgram(name: string, fs: FileStats): string;

  /** `findProgram` on the real file system, once per name. */
  export function program(name: string): string;
  ```

  `FileStats` is `{ lstat(path): { uid; mode; isSymbolicLink(); isDirectory() } | undefined; readlink(path): string }`. `untrustedReason` walks each component from `/`, follows a link at most 40 times, and rejects a component whose `uid` is not 0, or whose `mode & 0o022` is not 0. The error says: "Codeman runs `<name>` only from /usr/bin, /usr/sbin, /bin or /sbin, owned by root and writable by no other user. This runner has none: `<reason>`."
- Give `sudo` and `sudoCapture` the program's name apart from its arguments: `sudo(name, args, input?)`, `sudoCapture(name, args)`, and `sudoAs(user, name, args, input?)` for `-u`. All three build their arguments with an exported, pure `sudoArgs(name, args, user?, resolve = program)`, which returns `["-n", ...(user ? ["-u", user] : []), "--", resolve(name), ...args]`, and spawn `program("sudo")`.
- Update every call: `createAgentUser`, `installForAgent`, `copyToAgent`, `writeAsAgent` (`sudoAs`), `killAgentProcesses`, `trySudo` (`crontab` and `loginctl` may be missing: skip that stop when `findProgram` throws, as it is best-effort today), the `atq` cleanup (`sudoAs(AGENT_USER, "bash", ...)`), `pgrep`, and `runAsAgent` (`spawn(program("sudo"), ...)`, `program("bash")` for `/bin/bash`).
- `spawnSync(program("id"), ...)` at line 42.
- Replace `spawnSync("sleep", ["0.1"])` at line 111 with `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)`: no program at all.
- `createAgentUser` resolves every required program first (`sudo`, `id`, `useradd`, `usermod`, `chown`, `chmod`, `install`, `rm`, `cp`, `mkdir`, `tee`, `pkill`, `pgrep`, `git`, `test`, `env`, `find`, `realpath`, `bash`, `sh`), so a runner that lacks one fails before the run reaches its model.

In `src/collect.ts`:

- `statusCommand` becomes `statusArgs`, without `"git"`, run with `sudo("git", statusArgs(...))`.
- `classifyPaths` and `copyPaths`: `sudoCapture("env", [`--chdir=${worktree}`, program("find"), ...])` and `sudo("env", [`--chdir=${worktree}`, program("cp"), ...])`.
- `copyLiveAgentFile`: `spawnSync(program("sudo"), ["-n", "-u", AGENT_USER, "--", ...liveReadCommand(...)])`. `liveReadCommand` keeps `/bin/sh`; its `dd` runs as the agent, which gains nothing from planting one.
- The other calls take the name first: `test`, `realpath`, `cp`, `chown`, `rm`.

Elsewhere: `program("unzip")` in `src/results.ts:95,99`, and `program("tar")` in `src/harness/opencode.ts:102`, which import it from `src/sandbox.ts`.

Tests, all running everywhere unless marked:

- `src/sandbox.test.ts`, new case "a path is trusted only when root alone can change it": a fake `FileStats`. `/usr/bin/sudo` (root, `0755`, in root's `0755` directories) gives `undefined`. A directory of mode `0777`, one owned by uid 1001, a group-writable file, and a link from `/usr/bin/x` into a `0777` directory each give a reason naming the component. A loop of links gives a reason.
- Same file, "programs come only from trusted directories": `findProgram` returns `/usr/bin/x` when `/usr/local/bin/x` exists too, `/sbin/x` when only `/sbin` has it, and throws, naming `x`, when only `/usr/local/bin` or `/opt/pipx_bin` has it.
- Same file, "sudo's arguments name the command by its trusted path": `sudoArgs("git", ["status"], undefined, (name) => `/t/${name}`)` is `["-n", "--", "/t/git", "status"]`; with `AGENT_USER`, `["-n", "-u", "codeman-agent", "--", "/t/git", "status"]`.
- Same file, "the agent job runs no program by its name": reads `src/sandbox.ts`, `src/collect.ts`, `src/results.ts` and `src/harness/opencode.ts`. No `spawn(` or `spawnSync(` takes a string literal first, and no `sudo`, `sudoCapture` or `sudoAs` call takes an array first.
- `src/collect.test.ts:105`: runs `spawnSync("git", statusArgs(...))`; the test's own `git` runs on the developer's machine.
- `src/sandbox.test.ts`, "the agent is contained and its changes are collected safely" (Linux and CI only): before `createAgentUser`, the test makes a `0777` directory with `sudo`, puts it first on `process.env.PATH`, as a setup action's tool-cache directory would be, and makes `/usr/local/bin` world-writable if it is not. The agent's script writes `sudo`, `git`, `find`, `cp`, `chown`, `test`, `realpath`, `pkill` and `pgrep` scripts into every `PATH` directory it can write, each touching a marker in `/tmp`. After the fix pass, the seal and the collection, no marker exists.

Docs:

- [`docs/runs/agent.md#before-the-agent-runs`](../runs/agent.md#before-the-agent-runs), a new bullet: "Codeman runs each program it needs by its path in `/usr/bin`, `/usr/sbin`, `/bin` or `/sbin`, after checking that only root can change it; never by a name looked up in the job's `PATH`, whose directories the agent may write."
- [`docs/development/guide.md`](../development/guide.md#conventions), Conventions: "In the `agent` job, run a program only through `program(name)` from `src/sandbox.ts`, never by its name; a test checks it."

Commit message: `Run the agent job's programs from root's directories`.

Body: Codeman ran sudo, git and other programs by name. On GitHub's Ubuntu images, /opt/pipx_bin and /usr/local/bin are writable by every user and come before /usr/bin, so the agent could plant a program that Codeman then ran as the runner's user or as root.

### 2. Close the image's world-writable paths before the agent starts

**Done on 2026-10-19.** Assuming decision 2a. Where the work differs from the text below:

- `createAgentUser(log)` takes the step's log, and logs the closing's time: "Closed the runner's world-writable paths in <seconds> s." `src/steps/agent.ts` passes its runtime.
- The error names every directory of the `PATH` that has a problem, not only the first.
- `pathProblems` also follows each link in a `PATH` directory, and returns the directory when the agent could change the link's target.
- The regression test, "Codeman runs no program the agent could have planted, and closes their directories", runs last in `src/sandbox.test.ts`. Before `createAgentUser`, it opens `/opt/pipx_bin` and `/usr/local/bin` to every user again, and puts a `sudo` script in the first and a `git` script in the second. Each script appends a line to a marker when Codeman's step or root runs it. After the agent run, the seal and the collection, the marker is absent, and both directories are closed. On the sources before step 1, the test fails with the four `sudo` calls of `createAgentUser` in the marker.
- Other test files run alongside, and the planted `git` is on their `PATH`: for any other caller, each script runs the real program in `/usr/bin`. The test removes both scripts at its end.

First, measure: on a branch, the sandbox test runs the walk below on `ubuntu-latest` and logs its time. Over 60 seconds, stop, and bring this plan back for review with the numbers (decision 2).

> [!NOTE]
> On GitHub's runner, after the push, the walk took minutes: the sandbox test took 476 s, and CI's `npm test` step 8 min 21 s. The [plan to jail the agent](2026-10-19-jail-the-agent-in-a-read-only-mount-namespace.md) replaces the walk and the `PATH` check with a read-only mount namespace.

Measured on the [local runner image](../development/local-actions.md) instead, as the decisions say: the first closing took about 5 seconds (5.1 s, on a fresh container), and a second one under 0.1 s. GitHub's image has many more files, so this only bounds GitHub's time from below. The code logs the time, and the first runs on GitHub settle the 60-second threshold. `npm run test:runner` gave 640 tests, 626 passed, 0 failed, and 14 skipped: Firestore's emulator, as on CI. Every sandbox test passed.

Code, in `src/sandbox.ts`:

- Add an exported, pure `closeArgs(resolve = program)`, the arguments for `sudo("find", ...)`:

  ```ts
  ["/", "-xdev", "-perm", "-0002", "(", "-type", "f", "-o", "-type", "d", "!", "-perm", "-1000", ")",
   "-exec", resolve("chmod"), "o-w", "--", "{}", "+"]
  ```

  `-xdev` stays on the root file system, so `/proc`, `/sys`, `/dev` and `/run` are not walked. `find` does not follow links, and `-type f -o -type d` leaves them out. Directories with the sticky bit, such as `/tmp`, stay writable.
- Add an exported, pure `pathProblems(jobPath: string, fs: FileStats & { readdir(path): string[] }): string[]`. For each absolute entry of the job's `PATH`, it returns the entry when:
  - a component on the way to it, the entry included, is writable by others, unless the component is sticky and the next one exists;
  - the entry is missing and its nearest existing parent is writable by others, sticky or not, since the agent could create it;
  - a file directly in the entry is writable by others.
- `createAgentUser`, first: `sudo("find", closeArgs())`, then `pathProblems(process.env.PATH ?? "", realFs)`. On a problem it throws: "Codeman does not run the agent: `codeman-agent` could add or change programs in `<dir>`, on the job's PATH, which later steps run as the runner's user." This runs before `useradd`, and before the run reaches its model.

Tests:

- `src/sandbox.test.ts`, new case "a PATH is safe only when the agent can change none of its programs": a fake file system. Root's `0755` directories give no problem. A `0777` entry, a `0777` parent, a `0777` file in an entry, and a missing entry under a sticky `/tmp` are each returned. An entry under a sticky `/tmp` whose next component exists, owned by the runner with mode `0755`, is not.
- Same file, "closing leaves links and sticky directories alone": `closeArgs((name) => `/t/${name}`)` holds `-xdev`, `-perm -0002`, `-type f`, `-type d ! -perm -1000`, and `/t/chmod`.
- `src/sandbox.test.ts`, the contained case (Linux and CI only): the test's `0777` directory and a `0777` file in it are not writable by others after `createAgentUser`. The agent's script fails to create a file in each directory of the job's `PATH`, in `/opt`, in `/usr/share` and in `/usr/local/bin`. A second case gives the job's `PATH` a missing directory under `/tmp`, and `createAgentUser` throws, naming it.

Docs:

- [`docs/runs/agent.md#agent-sandbox`](../runs/agent.md#agent-sandbox):
  - the table: "Write in its copy of the checkout and in its home" becomes "Write in its copy of the checkout, in its home, and in temporary directories such as `/tmp`". A new row on the "cannot" side: "Change a program or file that runs outside the sandbox: those Codeman runs, and those the job's later steps run".
  - [Before the agent runs](../runs/agent.md#before-the-agent-runs), new bullets before the one of step 1:
    - "Codeman takes write access away from other users on every file and directory of the runner's root file system, except directories with the sticky bit, such as `/tmp`. GitHub's Ubuntu images leave `/opt`, `/usr/share` and `/usr/local/bin` writable by every user ([`configure-system.sh`](../web/github/runner-images-configure-system-sh-at-82d1b86.md), [`install-nodejs.sh`](../web/github/runner-images-install-nodejs-sh-at-82d1b86.md)). The agent installs its tools in its home: a global `npm install` into `/usr/local` fails."
    - "Codeman then checks the job's `PATH`. If `codeman-agent` could still add or change a program in one of its directories, the job fails before the agent starts, naming the directory."
  - The callout "The sandbox protects credentials, not the runner" stays: the agent still reaches the network and the runner's tools.
- [`docs/security/risks.md`](../security/risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox), section 3, after its first paragraph: "The agent itself cannot run code as the runner's user, through Codeman's step or through the steps after it, such as the post steps of `actions/checkout`, which run `git` from the job's `PATH`. Codeman runs its programs from root's directories, and closes the image's world-writable paths before the agent starts ([before the agent runs](../runs/agent.md#before-the-agent-runs)). This no longer depends on which directories the image and the setup actions put on the `PATH`." In "How to protect (risk 3)", add: "Run the `agent` job on a GitHub-hosted runner: Codeman changes the machine's permissions, and a new VM per job takes them away."

Commit message: `Close the runner's world-writable paths before the agent starts`.

Body: GitHub's Ubuntu images make /opt, /usr/share and /usr/local/bin writable by every user. The agent could plant a program there that a later step, such as actions/checkout's post step, ran as the runner's user, with sudo.

### 3. Close the plans

**Done on 2026-10-19.**

1. In the [correction plan](2026-10-16-correct-the-docs-against-the-code.md), link this plan from decision 7, and from step 1's note that the `PATH` escape awaits decision 7.
2. Set this plan to `completed`.

Commit message: `Complete the plan for the agent job's programs`.

## Out of scope

- Root services on the VM that may run files from `/usr/share` or `/opt`, such as the image's `/opt/post-generation` scripts. Decision 2a closes those paths, but no service was checked.
- Where the runner itself (its `node`, which runs `actions/upload-artifact` and the post steps) is installed on hosted runners. Not in `actions/runner-images`; not checked.
- The rules in `/etc/sudoers.d` that give the runner's user `sudo`, which may override `secure_path`. Step 1 makes Codeman independent of them.
- `PATH` entries in `/home/runneradmin` on arm64 images ([issue 11414](../web/github/path-is-different-on-ubuntu-24-04-arm-compared-to-ubuntu-24-04.md)). Step 2's check covers them if the agent could write them.
- Self-hosted runners, whose permissions step 2 would change for good.
- A `PATH` for the agent with `~/.local/bin` and an npm prefix in its home, so its global installs work again.
- The hostile-agent CI job of the [security roadmap](../security/overview.md#roadmap), item 2. The CI tests above cover the `PATH`, not the rest of that job.
