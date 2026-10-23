---
status: in progress
created_at: 2026-10-23T09:38:00-03:00
updated_at: 2026-10-23T09:43:00-03:00
commit: 18ecea4
---

# Commit on a moved task branch

## Goal

When someone pushes to the task branch while a routed stage's agent works, `apply` keeps their commits and either commits the agent's changes on top of them or blocks the task with a run comment that says why. A paid run is never lost without a word.

## Context

- **The bug.** The e2e suite found it ([5.4 results](2026-10-20-end-to-end-test-suite.md#54-results)). `apply` commits the agent's changes on the head `select` saw, and updates the branch without force (`commit` in `src/platform/github/platform.ts`). When the branch moved meanwhile, GitHub refuses with 422 "Update is not a fast forward", so the maintainer's commit is kept. But the error escapes `apply` (`src/steps/apply.ts`):
  - no run comment is posted;
  - the panel says "Writing the code", and the label stays `codeman:coding`;
  - there is no chain artifact, so next-run starts nothing.

  `failures/apply-branch-moved` reproduces it, tagged `known-bug`. No page of `docs/` says what should happen.
- **What the Platform offers.** `commit` "fails, changing nothing, if the branch moved since `baseSha`" ([platforms](../development/platforms.md#what-an-adapter-must-guarantee)); nothing lists the paths a range of commits changed. GitHub's [compare endpoint](../web/github/rest-api-endpoints-for-commits.md#compare-two-commits) does: its `status` says whether the head is `ahead` of the base, and its `files`, with a renamed file's `previous_filename`, list up to 300 changed files. The e2e fake GitHub serves it already.
- **The Data API commit.** It builds the tree from the base commit's tree plus the changed paths. So the same changes on the new head keep the maintainer's commits.

## Decisions

### Answered by the responsible person on 2026-10-23

1. If the maintainer's new commits touched none of the agent's paths, `apply` re-applies the agent's changes on the new head: a new commit whose parent is the new head, with the same tree changes. The task then goes on as normal.
2. Otherwise, `apply` blocks the task with a run comment that names the conflicting paths. `/codeman continue` runs the stage again on the new head.
3. The outcome is documented in `docs/tasks/lifecycle.md`, and in `docs/runs/changes.md` and `docs/tasks/comments.md` where they describe `apply`'s commit or the run comments.

### Choices made in this work

1. **The agent's paths.** Every path of the commit: written files, deletions (a rename is a deletion and an addition, since collection runs with `--no-renames`), and each staged workflow's `.codeman/workflows/` path. A staged workflow also counts its `.github/workflows/` path, which the accept will overwrite.
2. **The maintainer's paths.** A new `Platform.changedPaths(base, head)`: the paths that differ from the run's base to the new head, both paths of a rename included. It returns nothing when the head does not descend from the base (a rewritten branch), or when the platform cannot list every path (GitHub's 300 files). GitHub implements it with `compare`, `FakePlatform` by walking its commits.
3. **When the branch moved.** `commit` throws; `apply` reads the branch's head, and if it differs from the base, the branch moved. Any other failure is thrown as before.
4. **One retry.** If the branch moves again while `apply` commits on the new head, the task blocks, saying so.
5. **Three reasons, one block.** The paths in conflict, a branch that moved again, or new commits that could not be compared: each blocks the task with the outcome `blocked`, the same message and `/codeman continue <guidance>`. The reason is in the run comment's problems, where paths are rendered inert. The record keeps the stage, so `continue` resumes it with a fresh run count.
6. **Which commits.** A routed stage's commit, and review's proposed `.codemanignore`, which commits on review's base too. Planning, recorded answers and accepted workflows are left as they are (out of scope).

## Steps

1. **Failing tests.** In `src/steps/flow.test.ts`, on `FakePlatform`:
   - a maintainer's commit on other paths: the agent's changes, a deletion and a staged workflow included, are committed on the new head, and the task goes on;
   - a maintainer's commit on the agent's paths, a staged workflow's included: the task blocks, the run comment names the paths, the maintainer's commit is kept, and `/codeman continue` runs the stage on the new head;
   - a branch that moves again: the task blocks.

   Done when they fail on `HEAD`.
   - **Done on 2026-10-23.** On `HEAD`, each fails with the fake's "moved since" error out of `apply`. `agentResult` takes `null` for a deletion.
2. **The fix.** `changedPaths` in the Platform, GitHub and the fake; the retry and the block in `apply`; the messages in both catalogs. Done when the tests pass, `e2e/fakes/github/platform.test.ts` checks `changedPaths` against the fake GitHub, and `npm run build` rebuilds `dist/`.
   - **Done on 2026-10-23.** `commitOnBranch` in `src/steps/apply.ts`; the reason is a `BranchMoved` in `src/i18n/messages.ts`. Only `dist/index.js` changed.
3. **Docs.** `docs/runs/changes.md` says what happens when the branch moved; `docs/tasks/lifecycle.md` gets the block's row; `docs/development/platforms.md` gets `changedPaths`' guarantee. Done when `npm run check` passes.
   - **Done on 2026-10-23.** `docs/tasks/comments.md` lists no kinds of run comment and says nothing of the commit, so it is unchanged. `npm run check` passes: 891 tests, 5 skipped.
4. **The e2e scenarios.** `failures/apply-branch-moved` loses its `known-bug` tag and expects the block with the paths named, then `continue`; `failures/apply-branch-moved-disjoint` expects the commit on the new head. Done when `node --test "e2e/runtime/scenario/*.test.ts"` validates them, and later when each passes three times in a row (Docker is busy with step 5.5 now).
   - **Validated on 2026-10-23**; the runs wait for Docker. The disjoint scenario's maintainer adds `src/maintainer.ts`; the other's changes `src/health.ts`, which the agent writes too, and its second code round checks that it starts from the maintainer's version.
5. **The e2e plan.** Its 5.4 results say the bug is fixed, linking here. Then this plan is `completed`.

## Out of scope

- **Other commits on a moved branch.** A revised plan, recorded answers and accepted workflows still fail when the branch moves under them. Their window is short (answers and accepts read the head just before), or rare (a revised plan).
- **Keeping the agent's changes when the task blocks.** They are not committed anywhere; the next run of the stage starts from the new head.
- **Review on a moved branch.** Review that passes still marks the pull request ready, though it read the branch before the maintainer's commits.
- **Retrying GitHub errors** in general ([5.4 results](2026-10-20-end-to-end-test-suite.md#54-results), smaller findings).
