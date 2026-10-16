---
status: completed
created_at: 2026-10-16T12:45:25-03:00
updated_at: 2026-10-16T12:51:39-03:00
commit: e26a8c9
---

# Keep unfinished work collectable

## Goal

A run that ends early, out of budget or out of time, still commits what the agent did, whatever the agent left in its working tree; and agents leave in the working tree only what belongs in the commit, with progress notes that the next run continues from.

## Context

Codeman commits a stage's unfinished work, so the next run continues it. Two runs on target repositories ended early: one when its budget was spent, one at its time limit.

- In the run that hit its time limit, the agent had cloned two upstream repositories into a scratch directory inside the working tree. `git status` does not descend into an embedded repository: it reports it as one untracked entry, the directory's path with a trailing `/`. `collectChanges` passed that path to `cp` without `-r`, so `cp` copied the other files and exited non-zero, `sudo()` threw, and the agent job never wrote `manifest.json`. `apply` found no manifest and blocked the task: the whole run was lost.
- In the run that spent its budget, the commit held about 90 files of the agent's scratch out of 98: a copy of the repository made with `git archive`, test output, probe scripts and a backup. In a larger repository that would pass `max-files`, and nothing would be committed.
- The stage prompt already asks the agent to update the plan and leave a progress note, but at the end of the run; a run cut short leaves none.

Constraints: the manifest's format stays as it is; collection keeps its security properties (git runs with the trusted `.git`, only regular files are copied, the artifact upload never follows a symlink).

## Decisions

1. **How collection handles a directory entry.** Approved by the responsible person on 2026-10-16: list it in the manifest as changed, with `type: "other"`, like a symlink or a special file, and never copy it (no `-r`: a nested `.git` or a foreign repository's contents never leave the sandbox). A failure to copy one path must not keep `manifest.json` from being written. `apply` already drops `type: "other"` changes as "not a regular file" and lists them in the run comment.
2. **Where the agent learns to keep scratch work out of the working tree.** Approved on 2026-10-16: a short, generic rule. It goes in the stage prompt's rules, next to "Leave your changes in the working tree", since it concerns what Codeman commits.
3. **Where an interrupted run leaves its record.** Approved on 2026-10-16: a progress section in the task's plan, updated as the agent goes, which is committed with the partial work. The prompt says that this is allowed while the plan's scope and decisions stay as approved.
4. **ai-memory.** Evaluated and declined for now (2026-10-16): it is a server with its own data directory and SQLite database; its wiki is a nested git repository; it would not have survived this failure, which happened in collection after the agent; and memory pages merged across task branches would conflict. The progress notes cover the need.

## Steps

1. **Collection keeps the run.** `parseStatus` turns a trailing-slash entry into its path without the slash, with `type: "other"`; `collectChanges` copies only the other non-deleted paths. If the batch copy still fails, it copies each path on its own and lists the ones that fail as `type: "other"`, without a partial copy. Done when a nested repository and an uncopyable path both end in the manifest as `other`, and the other files are copied.
2. **Tests.** Unit test of `parseStatus` with a trailing-slash entry; the sandbox test gains a nested repository. Done when `npm test` passes (the sandbox test runs on CI only).
3. **Scratch rule.** The stage prompt tells the agent to keep scratch work in a temporary directory outside the working tree (the agent's `TMPDIR` is `/tmp`). Done when the prompt test checks it.
4. **Progress notes.** The stage prompt asks the stages that commit (all but review) to keep a progress section in the plan current as they go: what they tried, what failed, what worked, what is left. Done when the prompt test checks it, and review's prompt does not ask for it.
5. **Docs.** `docs/runs/agent.md` and `docs/runs/changes.md` say how directories and uncopyable paths are collected and reported; `docs/tasks/stages.md` mentions the progress notes and the scratch rule. Done when `npm run check` passes.

## Out of scope

- Raising `max-files`, or dropping scratch files by pattern in `apply`.
- Removing stale progress notes when a plan is revised.
- Committing the contents of embedded repositories, or tracked submodules.
