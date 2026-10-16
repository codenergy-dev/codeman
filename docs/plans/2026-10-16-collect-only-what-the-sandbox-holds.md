---
status: in progress
created_at: 2026-10-16T13:20:30-03:00
updated_at: 2026-10-16T13:20:30-03:00
commit: 227486f
---

# Collect only what the sandbox holds

## Goal

Collection, which runs as root over the agent's work tree, reads only what is inside that work tree, and only regular files and symlinks, even against an agent that tries to point a path elsewhere or leave a process running.

## Context

After the harness exits, the agent job collects the agent's changes as root: `git status` and `cp` read the agent's work tree, under the agent's home. The agent owns its home (`useradd --create-home`, `chmod 700`), so it can rename entries there and replace them with symlinks, and it may leave a process scheduled to run after the harness is killed. Two gaps follow:

- Root could be made to read files outside the work tree: the agent replaces `work` (or a path inside it) with a symlink, so `git status --work-tree` and `cp` follow it and copy files from elsewhere into the result, which `apply` then commits to the task branch.
- `cp` opens a named pipe (FIFO) the agent left in a tracked path, and blocks.

The kill after the harness (`killAgentProcesses`) does not reach work the agent scheduled to run later (cron, `at`, a systemd user service with lingering).

## Decisions

1. **Approved by the responsible person on 2026-10-16.** Before collecting: stop everything the agent could still run (remove its cron and `at` jobs, terminate its systemd user slice and disable lingering, lock the account, kill again and verify), then take its home and work tree away from it (`chown` to root, without following symlinks), so no surviving process can swap a path while collection runs. Then, as root, fail the step if the work tree is not a real directory (a symlink is refused), and copy only regular files and symlinks, filtered before `cp` so a FIFO or other special file is never opened.

## Steps

1. `sealAgentSandbox` in `src/sandbox.ts`: remove the agent's cron and `at` jobs, `loginctl terminate-user` and `disable-linger`, `usermod -L`, kill again and check no process is left; then `chown` its home and work tree to root without following symlinks. All best-effort for the lockdown commands, since a runner may lack `at` or `loginctl`. Called from `agent` after the harness, before collection.
2. In `collectChanges`: fail with a clear message if the work tree is a symlink or not a directory, before `git status`, so no manifest is written and the task blocks with "no result".
3. Classify the listed paths with one `find -maxdepth 0` call that opens nothing: regular files are copied, symlinks and everything else (FIFOs, sockets, directories) are listed as `type: "other"`/`"symlink"` and not copied.
4. `copyAgentFile` refuses a symlinked source or path component the same way.
5. Tests: unit tests where possible; the CI-only sandbox test gains a symlinked work tree (the step fails, nothing outside is copied) and a FIFO in a tracked path (listed as other, no hang, under a timeout).

## Out of scope

- Collecting changes to submodules or embedded repositories (already not collected).
- Restricting the agent's network or what it may read.
