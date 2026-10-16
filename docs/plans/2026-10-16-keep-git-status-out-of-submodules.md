---
status: completed
created_at: 2026-10-16T13:01:14-03:00
updated_at: 2026-10-16T13:03:13-03:00
commit: 9643577
---

# Keep git status out of submodules

## Goal

The `git status` that collects the agent's changes no longer enters submodules, whose repositories and configuration the agent controls.

## Context

The agent job finds the agent's changes with `git status`, run with `sudo`, using the original checkout's `.git` (trusted) against the agent's work tree. To tell whether a submodule changed, git runs inside the submodule's repository, with that repository's own configuration, which the agent can change. Only the trusted configuration may apply to that `git status`. Codeman never commits a submodule change anyway: it is not a regular file.

## Decisions

1. **How to keep git out of submodules.** Approved by the responsible person on 2026-10-16: pass `--ignore-submodules=all` to `git status`. Submodules are then neither entered nor listed.

## Steps

1. Add `--ignore-submodules=all` to the `git status` of `collectChanges`, in a function the unit tests can check. Done when a unit test fails without it (`src/collect.test.ts`, which runs git without `sudo`).
2. The sandbox test's submodule is no longer listed, and git leaves no sign of having entered it. Done when the test asserts both (it runs on CI).
3. `docs/runs/agent.md` says that collection does not enter submodules. Done when `npm run check` passes and `dist/` is rebuilt.

## Out of scope

- Collecting changes to submodules.
- Other changes to how collection reads the agent's work tree.
