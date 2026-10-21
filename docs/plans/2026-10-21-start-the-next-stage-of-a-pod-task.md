---
status: completed
created_at: 2026-10-21T11:16:03-03:00
updated_at: 2026-10-21T15:54:58-03:00
commit: 18c1b93
---

# Start the next stage of a task that ran on a pod

## Goal

A task whose stage ran on a pod starts its next stage in the repository's next run, joining the pod it keeps, instead of waiting 30 minutes for its batch to expire.

## Context

- **The bug.** The e2e suite found it ([5.1 results](2026-10-20-end-to-end-test-suite.md#51-results)): after a pod's plan with no decisions, the chain's next `select` logs the task ready and "Nothing to do". The kept pod is never joined, `release-pod` never runs, and the chain stops. `pods/ollama-keep-and-release` reproduces it, tagged `known-bug`.
- **The cause.** `exchange` (`src/board.ts`) builds `held`, every member of an unexpired batch that is not `dropped`, and skips the repository's own ready tasks that `held` names. A task a run started is its batch's `started` member for the batch's 30 minutes, so the repository's next runs skip it.
- **What the docs say.** [Forming batches](../runs/batches.md#forming-batches): the candidates are "its own ready tasks, read from GitHub this run, and the other snapshots' tasks that no unexpired batch holds". Only other repositories' tasks are held.
- **Why own tasks need no hold.** One run per repository is active (`concurrency: codeman`); that keeps two runs off one task ([plan for GPU batches across repositories](2026-10-13-gpu-batches-across-repositories.md#context)). When a `select` runs, the run that started a task's earlier stage has ended. After the honor loop, the repository's own members of unexpired batches are all `started` or `dropped`: the `started` ones are this run's honored tasks or an earlier run's.

## Decisions

### Approved by the responsible person on 2026-10-21

Fixing the bug now, as work separate from the e2e plan.

### Choices made in this work

1. **Own tasks: skip only those this run honors.** The loop over the repository's own tasks skips a task only when `honored` holds it. An honored task is so never put in a second batch by the same run. `held` still applies to the other snapshots' tasks.
2. **The old batch's `started` member stays `started`.** A task can then be `started` in its old batch and in the new one. Nothing needs it marked:
   - The registry counts a batch's member as pending on its pod only while it has no seat and no run lease there ([`claim`](../inference/pods.md#shared-pods)). A task that ran on its batch's pod has a seat on it for the pod's life, so it is never pending there.
   - Its next stage's `open-key` joins the pod it keeps: a task with a seat always has room on it.
   - `dropped` would say the task did not run, and the status set (`reserved`, `started`, `dropped`) is a stored format; a new status is not needed.
   - A `started` task that never joined its pod, as when its job failed before `open-key`, stays pending on that pod until the batch expires, as before this fix. At worst that pod takes one task fewer for those minutes; the docs already allow an inconsistency that makes a batch smaller.

## Steps

1. **A failing test.** In `src/board.test.ts`, a repository's task that started in a pod batch is formed again by the repository's next run within the batch's 30 minutes, and a task honored this run is not formed into a second batch. Done when the first part fails on `HEAD`.
   - **Done on 2026-10-21.** `a task its repository started is formed again by the next run, but never twice by one run`: on `HEAD`, the next run formed nothing.
2. **The fix.** In `exchange`, the own-task loop skips `honored` tasks instead of `held` ones. Done when `src/board.test.ts` passes and `npm run build` rebuilds `dist/`.
   - **Done on 2026-10-21.**
3. **Docs.** [Forming batches](../runs/batches.md#forming-batches) says that a task the repository started earlier is a candidate again. Done when the page says it.
   - **Done on 2026-10-21.**
4. **The e2e scenario.** `pods/ollama-keep-and-release` loses its `known-bug` tag and comment. Done when it and `pods/ollama-release-after-decisions` each pass three times in a row: the next stage joins the kept pod, no second pod is created, and `release-pod` terminates it.
   - **Done on 2026-10-21.** Three passes of `npm run test:e2e -- pods`: `ollama-keep-and-release` in 138 s, 136 s and 133 s, `ollama-release-after-decisions` in 50 s, 45 s and 44 s. Each pass created one pod; the route, code and review stages shared it, and the review's `release-pod` terminated it.
5. **The e2e plan.** Its 5.1 results say the bug is fixed, linking here. Then `npm run check` passes, and this plan is `completed`.
   - **Done on 2026-10-21.**

## Out of scope

- Other repositories' snapshot tasks that an unexpired batch holds as `started`. A repository's snapshot leaves out the tasks its run starts, in the same transaction, so a snapshot lists such a task only after a later run of its repository found it ready again and did not start it. Other repositories then wait for the batch to expire before batching it, while its own repository can still form it. This delays a batch; it does not stop a chain.
- Marking a task's old batch member when the task starts again.
