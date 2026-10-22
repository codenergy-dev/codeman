---
status: completed
created_at: 2026-10-22T16:20:00-03:00
updated_at: 2026-10-22T18:20:00-03:00
commit: 5c04539
---

# Fail the tasks waiting for a failed pod

## Goal

A task that joined a pod whose start fails fails with the gateway's reason, and never creates another pod, even when the pod's creator terminated the pod first.

## Context

- **The bug.** The e2e suite found it ([5.2 results](2026-10-20-end-to-end-test-suite.md#52-results)): a task that waits for a pod another task of its batch creates does not fail with the pod's failed start. It creates another pod of the same settings, which fails the same way. `pods/start-failure-two-tasks` reproduces it, tagged `known-bug`.
- **The cause, verified.** The creator's `open-key` (`#create` in `src/inference/selfhosted.ts`) reads the failure, ends the pod's registry document and terminates the pod at once. The joiner's next poll, up to 10 seconds later, finds the pod gone: `waitUntilReady` throws "Pod … no longer exists.", which is not a `PodStartFailure`. `#claim` so leaves the pod, finds no live pod for the settings, and creates one. A joiner that polls before the termination reads the failure from the gateway and fails, as intended; the order of the two polls decides.
- **What the docs say.** [Creating](../inference/pods.md#creating): "The tasks that waited for the pod fail with it rather than create another." [Choice 12 of the fit plan](2026-10-13-fit-ollama-to-the-gpu.md#decisions): the gateway keeps answering for 2 minutes so the tasks can read why, `open-key` "terminates the pod as today", and a task that joined the pod fails too.
- **What the registry holds.** A pod's document has `reason` once it ends ([data layout](../backend/data-layout.md#pod-registry)), free text that no code reads. The creator writes "it did not serve <model>" there today.

## Decisions

### Approved by the responsible person on 2026-10-22

Fixing the bug now, as work separate from the e2e plan.

### Choices made in this work

1. **The joiner reads the failure from the registry.** When a task cannot join a pod and the error is not a `PodStartFailure`, it reads the pod's document, which its leave already returns. If the pod ended for a failed start, the task fails with the gateway's message, as a `PodStartFailure`, and creates no other pod. The alternative weighed:

   | Option | For | Against |
   | --- | --- | --- |
   | **A. The registry's `reason` (chosen)** | Keeps choice 12 as written: the creator terminates the pod at once. Works whenever the joiner polls. The creator ends the document before it terminates the pod, so a joiner that finds the pod gone always finds the reason. No new field | Joiners read a prefix of a free-text field |
   | B. The creator leaves the pod to its joiners, which the last ends and terminates, or which terminates itself 2 minutes after its failure | No stored text is read | Departs from choice 12, an approved decision. A joiner that polls after the 2 minutes still creates another pod |

2. **The reason of a failed start.** The creator ends the document with `its start failed: ` and the `PodStartFailure`'s message, such as "its start failed: Pod pod1 did not serve qwen2.5:0.5b: …". Its other failures keep "it did not serve <model>". This uses the existing `reason` field: no storage schema changes. A joiner on an older version of Codeman does not read it, and behaves as before; an older creator writes the old reason, and a newer joiner behaves as before.

## Steps

1. **A failing test.** In `src/inference/selfhosted.test.ts`, task 7 creates a pod and task 8 joins it; the start fails, task 7 terminates the pod before task 8 polls again, and task 8 fails with the gateway's message without creating a pod. Done when it fails on `HEAD`.
   - **Done on 2026-10-22.** `a task that waits for a pod whose start fails fails with it, after its creator terminated it`: on `HEAD`, task 8 created a second pod.
2. **The fix.** `RegisteredPod` reads `reason`; `#create` ends a failed start's document with its message; `#claim` throws a `PodStartFailure` for a pod that ended so. Done when `src/inference/selfhosted.test.ts` and `src/inference/registry.test.ts` pass, and `npm run build` rebuilds `dist/`.
   - **Done on 2026-10-22.** `START_FAILED` and `startFailure` in `src/inference/selfhosted.ts`; `reason` in `RegisteredPod`. `dist/index.js` changed; `dist/gateway.js` did not, for this fix.
3. **Docs.** [Creating](../inference/pods.md#creating) says how the waiting tasks learn of the failure; [data layout](../backend/data-layout.md#pod-registry) says what `reason` holds for a failed start. Done when both pages say it.
   - **Done on 2026-10-22.**
4. **The e2e scenario.** `pods/start-failure-two-tasks` loses its `known-bug` tag and comment. Done when it passes three times in a row, and the other `pods/` scenarios and `parallel/four-tasks-one-pod` pass.
   - **Done on 2026-10-22.** `start-failure-two-tasks` passed in 30.9 s, 29.9 s and 30.1 s: the joiner logged "Could not join pod …: Pod … no longer exists.", then failed with the gateway's reason, and one pod was created. `npm run test:e2e -- pods`, which selects the 11 scenarios tagged `pods`, passed 10, `start-failure-two-tasks` among them in 25.5 s. `parallel/vllm-two-seats` failed one check, "The pod's tee: issues: 1, not 2": the two agents' requests did not meet at the engine. Its pod was created once and shared, and no join or start failed, so the fix's path did not run. On its own it then passed in 374.6 s, and `parallel/four-tasks-one-pod` in 116.7 s.
5. **The e2e plan.** Its 5.2 results, where the bug is recorded, say it is fixed, linking here. Then `npm run check` passes, and this plan is `completed`.
   - **Done on 2026-10-22.** The line is in the 5.2 results, after the bug's warning, since the bug is recorded there.

## Out of scope

- **A task still waiting for the creation lease.** A task whose claim waits ("Another task is creating the pod…") and that has not joined the pod when its start fails finds no live pod at its next claim, and creates one. The creator registers the pod as soon as Runpod creates it, and a start fails minutes later, so such a task has joined long before.
- **Other failures of a joined pod.** A pod that does not serve in 25 minutes, or whose gateway does not apply the settings, still ends with "it did not serve <model>"; a joiner that cannot join it claims again, as before.
