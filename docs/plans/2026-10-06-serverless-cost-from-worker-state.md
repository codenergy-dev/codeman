---
status: pending
created_at: 2026-10-06T20:43:40-03:00
updated_at: 2026-10-06T21:00:00-03:00
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

1. On the test account, with no worker running (it costs nothing): read `/health`'s workers as Runpod reports them, and record the page in `docs/web/runpod/`. Done when the plan says which states it reports and under which names.
2. The gateway's meter for Serverless: worker samples from `/health`, the counted time per decision 1, and the run's limit (`402`) on the same meter. Done when `usage` and `queue` tests cover a cold start, a wait without a worker, an idle timeout between requests and a worker serving another repository.
3. A run without a worker, per decision 2. Done when a test with a fake endpoint fails the run after the limit, and logs why.
4. Docs: [`docs/architecture.md`](../architecture.md) (Serverless and Spend), and the plan's notes on Serverless in the [spend table plan](2026-10-06-spend-table-providers-and-estimates.md) if it is done first. Done when they describe the new estimate.
5. Rebuild `dist/` and run `npm run check`. Done when it passes.

## Out of scope

- Runpod's billing per endpoint as the source: it is hourly, late, and shared between repositories.
- The month's spend; see the [spend table plan](2026-10-06-spend-table-providers-and-estimates.md).
