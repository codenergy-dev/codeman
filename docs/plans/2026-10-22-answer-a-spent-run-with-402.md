---
status: completed
created_at: 2026-10-22T16:06:00-03:00
updated_at: 2026-10-22T17:05:00-03:00
commit: 5c04539
---

# Answer a spent run with 402

## Goal

A pod's gateway answers every request of a run it stopped for its budget with `402` `budget_exceeded`, as [the budget cut-off](../inference/self-hosted.md#the-budget-cut-off) says, so the agent does not retry it.

## Context

- **The bug.** The e2e suite found it ([5.3 results](2026-10-20-end-to-end-test-suite.md#53-results)): a spent run gets `402` only until the next tick, at most 15 seconds. Then `expireRuns` stops it, and `Gateway.handle` (`src/gateway/gateway.ts`) answers its requests `503` `run_stopped`, as `#forward` does for the request in flight when the run stops. OpenCode's AI SDK retries a `503`, so the agent goes on sending requests for minutes while the pod waits for the run's close, and the pod's untracked time grows. `budgets/spent-run-gets-402` reproduces it, tagged `known-bug`.
- **Why a run is stopped.** Only `#stop` sets a run's `stopped`, for three reasons:

  | Reason | Where | Docs | Answer after the fix |
  | --- | --- | --- | --- |
  | Its budget is spent | `expireRuns`, on pods | `402` ([the budget cut-off](../inference/self-hosted.md#the-budget-cut-off)) | `402` `budget_exceeded` |
  | No request for 30 minutes | `expireRuns`, on pods | The run is stopped ([self-termination](../inference/pods.md#self-termination)); no status | `503` `run_stopped`, unchanged |
  | A request waited 25 minutes with no worker | `observe`, Serverless | The waiting requests fail and the agent job stops the agent ([Serverless](../inference/serverless.md#when-a-run-has-no-worker-or-no-report)); no status | `503` `run_stopped`, unchanged |

- **Not stops.** A run ended by `/admin/end`, or replaced by its task's next run, is closed, not stopped: its token is revoked ([runs and tokens](../inference/self-hosted.md#runs-and-tokens)), and the gateway answers `401`. That stays.

## Decisions

### Approved by the responsible person on 2026-10-22

Fixing the bug now, as work separate from the e2e plan. Only a stop for the budget answers `402` `budget_exceeded`.

### Choices made in this work

1. **A stop carries its answer.** `#stop` takes the status, code and message the run's requests get from then on; `handle` and `#forward`'s abort answer with them. A run stopped for its budget answers `402` `budget_exceeded` with the message it got before its stop, also after its close.
2. **The other stops keep `503` `run_stopped`.** The docs give them no status, and the task asked to change only the budget's. A silent run's agent that comes back would still retry; that is recorded below, not changed.

## Steps

1. **A failing test.** In `src/gateway/gateway.test.ts`, a run stopped for its budget gets `402` `budget_exceeded`, both for a new request and for the one in flight when it stops; a run stopped for its silence gets `503` `run_stopped`. Done when it fails on `HEAD`.
   - **Done on 2026-10-22.** `a run stopped for its budget answers 402, which agents do not retry; one stopped for its silence 503`: on `HEAD`, the request in flight got `503`.
2. **The fix.** `#stop` records the answer, `handle` and `#forward` give it. Done when `src/gateway/gateway.test.ts` passes, the existing test that expected `503` after a budget stop expects `402`, and `npm run build` rebuilds `dist/`.
   - **Done on 2026-10-22.** A `Stop` holds the answer: `SPENT` for the budget, `otherStop` for the others. `dist/gateway.js` and `dist/index.js`, whose Serverless runs bundle the gateway, changed.
3. **Docs.** [The budget cut-off](../inference/self-hosted.md#the-budget-cut-off) says the stopped run's requests keep getting `402`, and the other stops `503`. Done when the page says it.
   - **Done on 2026-10-22.** A table of a run's answers: spent, stopped otherwise, ended.
4. **The e2e scenario.** `budgets/spent-run-gets-402` loses its `known-bug` tag and comment. Done when it passes three times in a row, and `budgets/shared-pod-402` passes.
   - **Done on 2026-10-22.** `spent-run-gets-402` passed in 57.7 s, 56.6 s and 58.3 s, against 208 to 217 s with the bug: OpenCode logged the spent run's `402` as `"isRetryable":false`, and no request got `503`. `shared-pod-402` passed in 195 s, against 265 to 353 s; its comment no longer names the bug.
5. **The e2e plan.** Its 5.3 results say the bug is fixed, linking here. Then `npm run check` passes, and this plan is `completed`.
   - **Done on 2026-10-22.**

## Out of scope

- **Publishing and pinning new pod images.** The fix is in `dist/gateway.js`, so it reaches pods only once images built from it are pinned in `POD_IMAGES`, in a later commit ([pod images](../development/guide.md#pod-images)). The e2e pods run the e2e bundle, so the scenario checks the fix now.
- **A silent run's `503`.** A run stopped after 30 minutes without a request still answers `503`, which an agent that comes back retries until its job ends.
- **Serverless budgets.** The agent job's gateway never calls `expireRuns`: a spent Serverless run gets `402` from `handle`'s budget check, as before.
