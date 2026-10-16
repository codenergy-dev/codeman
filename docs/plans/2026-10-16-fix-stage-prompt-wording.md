---
status: completed
created_at: 2026-10-16T13:28:25-03:00
updated_at: 2026-10-16T13:28:25-03:00
commit: 8fc2156
---

# Fix stage prompt wording

## Goal

The stage prompt tells the review stage that it commits nothing, and tells a revised plan to keep its progress notes.

## Context

Two wordings in `src/prompt.ts` were wrong after progress notes were added:

- The time-limit rule told every stage, review included, that unfinished work is committed. Review commits nothing, so a run it does not finish leaves no result.
- On replan, the planning agent was told to update the plan but not what to do with its `## Progress` section. The work earlier runs left stays on the task branch, so the section should be kept, marked as predating the revision, and the stages follow the revised steps.

## Decisions

Approved by the responsible person on 2026-10-16.

## Steps

1. Make the time-limit rule stage-aware: review writes its output and is told it commits nothing; the other stages keep the "unfinished work is committed" wording. Done.
2. On replan, tell the planning agent to keep the `## Progress` section and mark that its notes predate the revision. Done.
3. Cover both in `src/prompt.test.ts`. Done.

## Out of scope

- Any change to how progress notes are written or committed.
