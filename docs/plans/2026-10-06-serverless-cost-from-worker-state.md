---
status: completed
created_at: 2026-10-06T20:43:40-03:00
updated_at: 2026-10-06T22:36:13-03:00
commit: 3f6983b
---

# Serverless cost from the worker's state

## Goal

A Serverless run counts only the time a worker is billed, so a run whose requests wait in the queue with no worker spends nothing of the task's budget; and a run that gets no worker fails early, as a pod run without a GPU does.

## Context

- The agent job's gateway estimates a Serverless run's cost as the union of its requests' spans, each followed by the endpoint's idle timeout, at the flex price of the endpoint's dearest GPU type ([`src/gateway/usage.ts`](../../src/gateway/usage.ts)). A request's span starts when it reaches the gateway.
- Since requests go through Runpod's job queue ([`src/gateway/queue.ts`](../../src/gateway/queue.ts)), a request waits as long as no worker serves it. With no GPU available, the run waits until the agent's time limit, and its estimate grows the whole time, up to the run's limit, although Runpod bills nothing: the task's budget is spent on nothing.
- Runpod bills a worker only while it is **Running**: from its handler's start (the model's load included) through its requests and its idle timeout. Pulling the image and downloading a cached model happen while it is **Initializing**; **Throttled** (no resources on the host) and **Unhealthy** (crashed) are not billed ([worker states](https://docs.runpod.io/serverless/workers/overview#worker-states)).
- `GET /health` reports the endpoint's jobs and its workers by state; its documented example shows only `idle` and `running` ([operation reference](https://docs.runpod.io/serverless/endpoints/operation-reference#health)). Calling it costs nothing.
- An endpoint may serve several repositories; its workers' time is then not this run's alone.
- On pods, no GPU fails the run: the pod is not created, or not ready within 25 minutes. The responsible person wants the same for Serverless (2026-10-06).

## Decisions

1. **Where a run's billed time comes from.** Options:
   - (a) The gateway asks `/health` every few seconds during the run, and counts the time when a worker is running and the run has a request open or within the idle timeout after one. The idle timeout after the run's last request is added, as today.
   - (b) Each job's `executionTime`, from `/status`, plus the idle timeout after it. It leaves out the model's load, which Runpod bills but reports in the job's `delayTime`, along with time in the queue.
   - (c) Today's spans, less the time each job spent `IN_QUEUE`, as `/stream` reports it. The model's load is left out too.

   Recommendation: (a). Only the worker's state tells a start, which is billed, from a wait without a worker, which is not. Counting only while the run has a request open keeps out other repositories' use of the worker when this run is silent.

   **Answer:** (a).
2. **A run without a worker.** Options:
   - (a) When no worker has been initializing or running for 25 minutes while a request waits, the gateway fails the waiting requests and stops serving the run, so the agent stops and the run fails, as a pod run without a GPU does.
   - (b) The run waits until the agent's time limit, as today, at no cost after decision 1.

   Recommendation: (a), as the responsible person asked. 25 minutes is a pod's start limit, and covers a cached model's download.

   **Answer:** (a).

The responsible person answered every decision on 2026-10-06 with its recommendation.

## Steps

1. Read `/health`'s workers from Runpod's documentation and SDKs, and record the pages in `docs/web/runpod/`. The gateway reads `/health` tolerantly: a worker is billed when `running` is above 0, and starting when `initializing` is; a sample that fails or that it cannot read is unknown, and unknown time counts as billed, as today's estimate does. The live check on the test account moves to the [end-to-end test](#end-to-end-test), since the account's key is only in the repository's secrets. Done when the plan says which states `/health` reports and under which names, and which of them the gateway reads. **Done on 2026-10-06**, without the test account (the step first planned to call `/health` there):
   - Names. The documented example reports `workers.idle` and `workers.running`. Runpod's Go SDK (`HealthWorkerOutput`) and JavaScript SDK (`HealthCheck`) name `idle`, `initializing`, `ready`, `running` and `throttled`, all counts; the Python SDK returns the JSON as it is. Recorded in [operation reference](../web/runpod/operation-reference.md#health) (a `/health` section) and [Overview](../web/runpod/overview.md), Serverless's page on workers and their states; several Runpod pages are titled "Overview", and only this one is recorded.
   - Meaning. Only the worker states page says what states mean: Initializing (image, code, cached model) is not billed; Idle is "scaled down, waiting for requests", not billed; Running is billed, the model's load and the idle timeout included, which the console shows as Running; Throttled is not billed. So the gateway reads `running` as billed and `initializing` as a start, and reads `idle` as scaled down, like the console. `ready` is documented nowhere, so it counts for neither; `throttled` is a worker without a GPU. `running` missing or not a count makes the sample unknown; `initializing` missing counts as 0, as in the documented example.
   - Assumptions the end-to-end test must confirm: `running` covers a worker while vLLM loads the model and through its idle timeout; and the endpoint's restricted key may call `/health`. If either fails, the estimate undercounts or falls back to today's.
2. The gateway's meter for Serverless: worker samples from `/health`, the counted time per decision 1, and the run's limit (`402`) on the same meter. Done when `usage` and `queue` tests cover a cold start, a wait without a worker, an idle timeout between requests and a worker serving another repository. **Done on 2026-10-06**: `RunpodQueue.workers` reads `/health` (5-second timeout) and logs the workers each time they change, or why it failed ([`src/gateway/queue.ts`](../../src/gateway/queue.ts)); the agent job samples it every 5 seconds while the gateway serves the run, and stops before `finish()` reports usage ([`src/inference/access.ts`](../../src/inference/access.ts)); `Gateway.observe` keeps the samples; `busyMs` takes today's spans and removes the time between two samples that both saw no worker running ([`src/gateway/usage.ts`](../../src/gateway/usage.ts)). The time after the last sample is unknown and counts: that is how the idle timeout after the run's last request is added, as decision 1 says. The cases are covered in `usage.test.ts` (plus unknown samples), `queue.test.ts` (reading and logging `/health`), `gateway.test.ts` (the `402` on the same meter) and `serverless.test.ts` (a cold start and a failing `/health` through a fake endpoint).
3. A run without a worker, per decision 2. Done when a test with a fake endpoint fails the run after the limit, and logs why. **Done on 2026-10-06**: the gateway's `noWorkerMs` (25 minutes, a pod's `START_MINUTES`) counts from the first sample that sees no worker initializing or running while a request is open; a sample that sees one, or no request open, starts it over, and an unknown sample does neither. Then the gateway logs why, fails the waiting requests with `503` (`run_stopped`) and the reason, answers later requests the same, and aborts the access's `stopped` signal. `runAsAgent` takes that signal and stops the agent as at its time limit; the agent step skips the output fix, keeps the result and fails with "The run stopped: No worker of the endpoint started or ran for 25 minutes while a request waited, as when it has no GPU." The jobs left in the queue are cancelled. Tests: `gateway.test.ts`, `serverless.test.ts`, and `sandbox.test.ts`, which runs on Linux runners only, as in CI. Differs from a pod run without a GPU in one way: that run fails in `open-key`, and `apply` says to try later; this one fails in `agent`, and `apply` handles it as any failed agent job: it keeps the agent's changes and, without a valid output, blocks the task with the agent's exit code. Changing that needs a new field in the agent's manifest, a data format change outside this plan.
4. Docs: [`docs/architecture.md`](../architecture.md) (Serverless and Spend), and the plan's notes on Serverless in the [spend table plan](2026-10-06-spend-table-providers-and-estimates.md) if it is done first. Done when they describe the new estimate. **Done on 2026-10-06**: architecture's Serverless section describes the estimate and the 25-minute limit, and its gateway and mode table follow; [installation](../installation.md) says what happens without a worker; the spend table plan has a note under its table. The spend table's Serverless note ("an estimate of the time Runpod bills its workers") still fits, so `en.ts` and `pt-BR.ts` are unchanged.
5. Rebuild `dist/` and run `npm run check`. Done when it passes. **Done on 2026-10-06**: 339 tests, 337 pass and 2 skipped (the sandbox's, Linux runners only).

## End-to-end test

On the Runpod test account, with the endpoint set up as [installation](../installation.md#self-hosted-inference-on-runpod) says.

1. **`/health`, live.** With no worker running, which costs nothing, call `curl -fsS -H "Authorization: Bearer $KEY" https://api.runpod.ai/v2/<endpoint>/health` with the endpoint's restricted key: it must answer, not `401`, and show the worker states it reports. Then run a task with `gpu-mode: serverless`. The agent job's log, in Codeman's step, has a line `Runpod's workers: {...}` each time the workers change, and no `Runpod GET /health failed`. Compare with the endpoint's **Workers** tab and the worker's logs in Runpod's console:
   - While the image or the cached model is pulled, `initializing` is above 0 and `running` is 0.
   - From when vLLM starts loading the model, `running` is 1 (the model's load is billed). If `initializing` stays above 0 until vLLM serves, the estimate leaves out the load: report it.
   - After the agent's last request, `running` stays 1 through the idle timeout, then the worker scales down. If the idle timeout shows as `idle` or `ready`, idle time between requests is left out: report it.
   - Record the field names seen in [operation reference](../web/runpod/operation-reference.md#health).
2. **A run without a worker.** Make the endpoint unable to get a GPU while it passes `open-key`'s checks: max workers stays 1, but its only GPU type is one with no supply in its data centers (the console shows each type's availability). Run a task. The log shows `Runpod's workers` with `running` and `initializing` at 0. After 25 minutes, it shows "No worker of the endpoint started or ran for 25 minutes while a request waited", then "The agent was stopped", and the agent job fails with "The run stopped: …". Runpod's console shows the run's job cancelled. The run's row in the spend table costs no more than the idle timeout at the flex price. Restore the GPU type.
3. **A normal run's cost.** Run a task whose endpoint no other repository uses that hour, and note each run's cost from the spend table (the agent job's `gateway-usage` output has it too). An hour or more later, compare it with Runpod's billing for the endpoint for those hours ([Serverless billing history](../web/runpod/get-serverless-billing-history.md)): the estimate should be close and not below, since it uses the dearest GPU type's price and counts up to 5 seconds around each change of state. Before this plan, the time in the queue counted too.

## Out of scope

- Runpod's billing per endpoint as the source: it is hourly, late, and shared between repositories.
- The month's spend; see the [spend table plan](2026-10-06-spend-table-providers-and-estimates.md).
