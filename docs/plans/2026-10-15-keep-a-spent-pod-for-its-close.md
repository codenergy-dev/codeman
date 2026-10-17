---
status: completed
created_at: 2026-10-15T21:09:30-03:00
updated_at: 2026-10-17T13:02:25-03:00
commit: c26cd15
---

# Keep a spent pod for its close

## Goal

A pod whose runs all spent their budget, or went silent, waits for the key jobs to end those runs and read their usage, instead of terminating at once; and `close-key` reads that usage more sturdily, and, when it cannot, counts no more than the run's limit for a run on a shared pod.

## Context

- **The incident.** Three tasks shared one vLLM pod (`runpod-pod`, `pod-reuse: task`, [shared pods](../inference/pods.md#shared-pods)). One task's `code` run, by then the only run on the pod, reached its limit (US$ 1.03). The gateway answered the agent `402`; within 15 seconds its interval (`src/gateway/main.ts`) found every run on the pod spent (`expiry` in `src/gateway/pod.ts`) and terminated the pod. The container restarted before Runpod terminated it, and a restarted pod refuses to serve. `close-key` then called `POST /admin/end` once and got `404` from Runpod's proxy. Without the gateway's figure, `close` (`src/inference/selfhosted.ts`) counted the pod's whole time since the run started, unsplit: US$ 1.22, above the run's limit, which the gateway never lets a run's share pass. The tasks then counted US$ 1.40 for a pod that cost about US$ 1.22, and the run's tokens were lost.
- **How a run stops today.** `Gateway.expireRuns` stops a run that spent its budget or made no request for 30 minutes (`#stop`): its requests fail, and it ends (`#end` sets `end`), so `podShares` (`src/gateway/usage.ts`) gives it no more of the pod's seconds; they go to the other runs, to the tasks that keep the pod, or to nobody (the pod's untracked time). A stopped run's `#deadline` is undefined. But the interval calls `expireRuns` only when `expiry` finds a run that goes on: when every run is spent or silent, `expiry` terminates the pod first, and the runs are never stopped.
- **`/admin/end` again.** `endRun` finds the run by its token's hash (the last run without one), ends it (`end ??=` keeps the first end), adds a keep span only when the task does not keep the pod already, and returns its usage: calling it again returns the same run's usage, so a retry is safe.
- **The handle.** `PodHandle` does not carry the run's limit; `#attach` has it (`run.limit`).
- **Images.** The gateway runs in Codeman's pod images (`docker/pod/Dockerfile`), pinned by digest in `POD_IMAGES` (`src/inference/images.ts`). Pods on the images pinned now keep the old gateway until the images are rebuilt from this change and pinned ([pod images](../development/guide.md#pod-images)); the client-side changes must work with them.
- **Constraints.** No dependency, permission, secret or workflow change. `POD_IMAGES` does not change in this work: the responsible person publishes the images from its commit and sends the digests.

## Decisions

### Approved by the responsible person on 2026-10-15

The fix as proposed: the gateway stops the runs and waits for their closes, terminating itself only after a grace period; `close` retries `/admin/end`, caps its fallback at the run's limit with a warning, and warns when the gateway does not know the run; tests and docs; images rebuilt and pinned afterwards. The choices left open are recorded below.

### Choices made in this work

1. **The grace period is the pod's kept-idle time** (`keptIdleMs`, from `CODEMAN_KEPT_IDLE_MINUTES`, 15 minutes as `KEPT_IDLE_MINUTES` sets it), counted from when the last run stopped, rather than a new 10-minute constant. Once every run is stopped, the pod has no run being served, and the rule that already applies to such a pod applies: it terminates after that long without activity. Reasons: a shorter grace for stopped runs would cut short the keep another task holds on the same pod, since both rules count from the pod's last activity; `close-key` waits for a runner after the agent job ends, which can take minutes; and the field already reaches the pod, so neither the client nor the image gains a coupling. When no close comes, the pod costs at most 15 minutes more than before, as the pod's untracked time, or the keepers' share.
2. **Stopped runs.** `expireRuns` runs at every tick, before `expiry`, and stops every spent or silent run, alone or all together. `expiry` no longer reads runs' deadlines: while a run is served the pod goes on; without one, it waits the kept-idle time. A stopped run takes no more of the pod's seconds from its stop, as today (its span ends then), and its deadline stays undefined. The reason the pod logs when it terminates says whether a stopped run still waited for its close. Runs stopped for silence are treated the same. A pod whose model was never served keeps its rules.
3. **`/admin/end` retries**: 3 attempts, 5 seconds apart, through the provider's injectable `wait`. A `200` with `null` (the gateway does not know the run, as after a restart) is not retried, and warns.
4. **The fallback is capped on shared pods only.** On a shared pod, a run without the gateway's figure counts the pod's time since it started, capped at its limit, with a warning that it is an estimate. The handle gains an optional `limit`; a handle without it (from an earlier commit) keeps the uncapped figure. A pod that serves one run at a time (the images in `SINGLE_RUN_IMAGES`) is the task's alone: its run already counts the pod's time since it started, whatever the gateway says, and the task counts the pod's whole life anyway, so a cap would only move the excess into the task's time outside its runs. It stays as it is.
5. **`GATEWAY_VERSION` stays 2.** The admin API does not change: the same routes and fields. `#attach` refuses a shared pod whose gateway reports a lower version, so a bump would refuse the images pinned now until new ones are pinned.

## Steps

1. **Gateway.** `src/gateway/main.ts` stops spent and silent runs at every tick, then asks `expiry`; `expiry` (`src/gateway/pod.ts`) terminates a ready pod only after the kept-idle time without a run being served, naming the stopped runs that wait for their close in its reason; the gateway (`src/gateway/gateway.ts`) reports whether a stopped run waits for its close. Done when the tests below pass.
   - **Done on 2026-10-15.** `PodState` lost the runs' deadlines; it gained `awaitingClose`, which the gateway reports from runs it stopped (`stopped`) and no `endRun` or later run of their task closed (`closed`).
2. **`close`.** In `src/inference/selfhosted.ts`: the handle carries the run's limit; `/admin/end` is tried 3 times, 5 seconds apart; a `null` answer warns; a shared pod's fallback is capped at the limit and warns. Done when the tests below pass.
   - **Done on 2026-10-15.** `END_ATTEMPTS` and `END_RETRY_MS`; `#endRun` logs each failed try as info and the last as a warning; `estimatedShare` gives the capped figure.
3. **Tests.** Gateway: a lone spent run is stopped and its pod does not terminate until the grace passes, then does; a stopped run's share stops growing; a silent run likewise; a close ends a stopped run and returns its usage, twice. `close`: a retry succeeds on the second attempt; the fallback is capped at the limit with the warning; a `null` answer warns. Done when `npm test` passes.
   - **Done on 2026-10-15**, in `src/gateway/pod.test.ts`, `src/gateway/gateway.test.ts` and `src/inference/selfhosted.test.ts`; the fallback's test also checks that a handle without `limit` keeps the uncapped figure.
4. **Docs.** [Pods](../inference/pods.md) (when a pod terminates itself; `close`'s retries and fallback), [spend](../budget/spend.md) (a shared pod's run without the gateway's figure), [self-hosted inference](../inference/self-hosted.md#the-gateway) (a spent run is stopped), and [upgrading](../installation/upgrading.md) (the gateway's change needs the images rebuilt). Done when the docs tests pass.
   - **Done on 2026-10-15**, with the [docs index](../README.md) and spend's untracked time, which includes the time a pod whose runs were all stopped waits for their closes.
5. **Check and commit.** `npm run check` passes, `dist/` rebuilt; one commit.
   - **Done on 2026-10-15**: 617 tests, 615 pass and 2 skipped (the sandbox's, Linux runners only). `dist/index.js` and `dist/gateway.js` changed, so the pod image workflow builds both images once the commit reaches `main`.
6. **Pin the rebuilt images.** Pending: the responsible person publishes both images from the commit of step 5 and sends their digests; they are pinned in `POD_IMAGES` in a commit of their own ([pod images](../development/guide.md#pod-images)). Until then, pods run the images pinned now: their gateway still terminates the pod once every run is spent, and only `close`'s changes apply to them.
   - **Done on 2026-10-17**: both images were published from `e26a8c9`, which contains this change and after which nothing in `docker/pod/`, `dist/gateway.js` or the workflow changed. They are pinned in `POD_IMAGES`.

## Out of scope

- Stopping a run in the request that finds its budget spent, rather than at the next tick: its share may pass its limit by up to 15 seconds of the pod's time, as before.
- Splitting the grace period's time among the stopped runs' tasks: it stays the pod's untracked time, or the keepers' share.
- Retrying the other admin routes, or reading the pod's usage after its gateway is gone.
- Capping a single-run pod's run cost (choice 4).
