---
status: in progress
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T21:10:02-03:00
commit: a8594ea
---

# Serverless cost split

## Goal

When runs share a Serverless endpoint's worker, each run's recorded cost is its share of the worker's billed time, as on a shared pod, instead of every run counting the shared time whole.

## Context

- Depends on the [Firestore backend](2026-10-07-firestore-backend.md) and the [ledger budgets](2026-10-07-budgets-from-the-ledger.md).
- **Today.** Each Serverless run's gateway runs in its own `agent` job and estimates the worker's billed time for its run from its requests and the endpoint's `/health` ([Serverless](../architecture.md#serverless), [Serverless cost plan](2026-10-06-serverless-cost-from-worker-state.md)). Gateways cannot see each other's requests, so time two runs share counts for each (step 6 of the [parallel tasks plan](2026-10-06-parallel-tasks-and-inference-profiles.md)).
- **No credentials in the agent job.** The gateway runs beside the agent, so it gets no access to Firestore ([backend plan](2026-10-07-firestore-backend.md), decision 3). Its records leave the job as its output, as its usage does today.

## Decisions

The responsible person approved the backend plan's recommendations on 2026-10-07, which this plan follows; the decisions below apply them, each with Codeman's recommendation.

1. **What is shared.** Options:
   - (a) The agent job's gateway reports its run's intervals (each request's open span, plus the `/health` samples) with its usage; `close-key` writes them to the ledger under the endpoint. A second of billed worker time is split evenly among the runs, of any repository of the organization, with a request open or within the idle timeout after one.
   - (b) Split by tokens.

   Recommendation: (a), as on pods: a GPU bills time, not tokens.

   **Answer:** (a).
2. **When the split is known.** Options:
   - (a) `close-key` computes its run's cost from the intervals in the ledger so far, and each later close on the same endpoint recomputes the overlapping runs' costs in the ledger. A task's spend table takes its runs' costs from the ledger at each `apply`, as it already refreshes rows.
   - (b) Wait for every overlapping run to close before recording a cost.

   Recommendation: (a). Costs only go down as overlaps appear, so a run's first figure errs on the side of the budgets.

   **Answer:** (a).
3. **The run's live limit.** Options:
   - (a) Unchanged: each gateway stops its run (`402`) on its own estimate, counting shared time whole.
   - (b) Gateways read each other's intervals live, which needs Firestore in the agent job.

   Recommendation: (a), per the backend plan's decision 3.

   **Answer:** (a).

## Steps

Refined on 2026-10-07 against the backend, the ledger and the pod registry as built ([backend plan](2026-10-07-firestore-backend.md), [ledger budgets plan](2026-10-07-budgets-from-the-ledger.md), [pod registry plan](2026-10-07-pod-registry.md)). The steps keep the decisions; what they settle beyond them is marked **Choice**.

- **What is built on.** The agent job's gateway keeps each request's span and the endpoint's `/health` samples, and `busyMs` ([`src/gateway/usage.ts`](../../src/gateway/usage.ts)) counts the union of the spans, each extended by the idle timeout, less the time between two samples that both saw no worker billed. Its usage leaves the job as the `gateway-usage` output, which `close-key` reads ([`ServerlessInference.close`](../../src/inference/selfhosted.ts)), and `Ledger.close` writes the run's `cost`, which the budgets read: the task's total and the repository's month (`spentBy`), and the organization's month (`reconciledMonth`), where a Serverless run spreads over its time and Runpod's billed hours reconcile it. `close-key` then outputs the task's total and each run's cost from the ledger (`task-total`, `task-costs`), and `apply` refreshes the spend table's rows from them. Pods split their time in the gateway (`podShares`), which sees every run on the pod.

1. **The report.** The gateway's usage of a Serverless run gains `busy`: the intervals its estimate counts, as `[from, to]` pairs in milliseconds since the epoch, so the run's cost is their length at its price. `busyMs` becomes their sum. `close-key` reads them (`parseUsage` checks them) and returns them with the endpoint and its price (`RunUsage.busy`). Done when tests cover a run's report: its intervals from requests, idle timeouts and samples, their sum as its cost, and a report too large.
   - **Choice: the intervals, not the spans and samples.** Decision 1 shares "each request's open span, plus the `/health` samples"; the gateway reports what it derives from them for the estimate: the spans merged after the idle timeout, less the time its samples saw no worker billed. Nothing the split needs is lost, and a run of a few hundred requests reports a few intervals, since the idle timeout joins requests that follow each other.
   - **Choice: GitHub's limit.** A job's outputs may hold 1 MB together, and a workflow run's 50 MB, counted in UTF-16 ([workflow syntax](../web/github/workflow-syntax-for-github-actions.md#jobsjob_idoutputs)). The report stays in the job's output, below 200,000 characters (400 KB; ten parallel tasks, 4 MB); a larger one, which would take thousands of intervals, leaves `busy` out, with a warning. Without intervals, the run counts its own estimate and takes no part in the split, and the runs it overlapped count that time whole: costs only err upwards. No artifact: it would need a download step in `close-key`, and a report that fits is the rule.
   - **Done on 2026-10-07**: `busySpans` in [`src/gateway/usage.ts`](../../src/gateway/usage.ts) gives the billed intervals (the spans merged after the idle timeout, less the merged time between two samples that both saw no worker billed), and `busyMs` sums them; `summarize` adds them as `busy` to a busy meter's usage, so the agent job's gateway reports them through `Gateway.usage` without a change to the gateway itself. [`usageReport`](../../src/inference/selfhosted.ts) writes the agent job's `gateway-usage` output, and leaves `busy` out above `MAX_USAGE_CHARS`, with a warning; `parseUsage` keeps `busy` only when its spans are numbers in order; `ServerlessInference.close` returns them as `RunUsage.busy` ([`provider.ts`](../../src/inference/provider.ts): `BusyTime`, with the handle's endpoint and price). Tests: `usage.test.ts` (intervals from requests, idle timeouts and samples; `summarize` with and without them), `serverless.test.ts` (a cold start's intervals through the agent job's gateway; `close` with valid and invalid intervals; a report too large).
   - **The pod image changes.** `busyMs` and `summarize` are bundled in `dist/gateway.js`; a pod's gateway uses a time meter and reports no intervals, so pods behave as before, and `POD_IMAGE` needs no new pin.
2. **The split** ([`src/ledger.ts`](../../src/ledger.ts)). `close-key` writes the run's intervals to the ledger under its endpoint, and in the same store transaction computes each overlapping run's share and writes it as that run's `cost`. Done when tests on the in-memory store cover two runs that overlap, one that closes before the other, runs of two repositories, and a re-run of `close-key`; and two closes at once on Firestore's emulator.
   - **Layout.** `organizations/{owner}/endpoints/{endpoint}/runs/{run}-{reservation}`: one document per run that reported intervals, with `run`, `repository`, `task`, `reservedAt`, `from` and `to` (its intervals' bounds), `pricePerSecond`, `busy` (the intervals, as JSON text: an array may not hold arrays, and one text field is one index entry), `estimate` (the gateway's) and `share` (the last split). The run's document gains `endpoint`. **Choice:** the document's ID adds the run's reservation (`reservedAt`, in milliseconds), so a re-run of `close-key` writes the same document, while a run that `open-key` reopened after it closed keeps its earlier attempt's intervals in the split, whose cost became `spentBefore`.
   - **The split.** As on a shared pod: each millisecond in the intervals of several runs is split evenly among them, each at its own price, so a run alone counts its estimate, and the runs' costs add up to the union of their intervals at their price (`busyShares` in [`usage.ts`](../../src/gateway/usage.ts), beside `podShares`). Each run's intervals are its own gateway's: a millisecond that one gateway's samples counted and another's did not counts for the first alone.
   - **The transaction.** It reads the run's document, then the endpoint's runs whose intervals end after the run's first one starts, less 2 hours (`RESERVATION_MS`: a run's intervals lie within its agent job, so every run that overlaps a run that overlaps this one is among them), and the documents of the runs that overlap this one. It writes this run's intervals, and the share of each run that overlaps it as its `cost`, when the run is `closed` and the intervals are of its current reservation. Closes at once run again until one sees the other's intervals, as reservations do, with up to 20 attempts. It runs after the job's other writes, in `flush`, like a pod's untracked time, and a failure fails the job, as other ledger writes do, leaving the run at its own estimate.
   - **Costs only go down.** Intervals are never removed, so each later close on the endpoint can only add runs to a millisecond: a run's cost is its own estimate at its close, and then its share as overlaps appear, never below it.
   - **Choice: what is written.** Only `cost`, never `limit` or `status`: an open run keeps counting its whole limit (its reservation), and a run that is not `closed` (expired, failed, or reopened) is left alone. The budgets read the new `cost` as any other: the task's total and the repository's month at once, and the organization's month spread over the run's time, reconciled with Runpod's billed hours, which still count the worker's time no run accounts for.
   - **Done on 2026-10-07**: `Ledger.close` records the run's `endpoint` and keeps its billed times; `flush`, after the job's writes and pods' untracked time, runs `#split` for each, a transaction of up to 20 attempts, wrapped in the ledger's retries. `busyShares` in [`usage.ts`](../../src/gateway/usage.ts); `LAYOUT.endpoint`, `endpointRuns` and `endpointRun` in [`layout.ts`](../../src/store/layout.ts). `close-key` logs whether the run used the worker alone so far, or what it counts of its estimate and how many other runs count less now. Tests in `ledger.test.ts`: two repositories' runs that overlap, the first closing alone at its estimate and then lowered by the second's close, with the repository's and the organization's months before and after, an open run's limit untouched, and a re-run of the second `close-key`; a run reopened by `open-key`, whose earlier attempt's time still splits and whose reservation is left alone; `close-key`'s `task-costs` and `task-total` with the share, and the other task's next `close-key` with its run's share. `emulator.test.ts`: two closes at once on Firestore's emulator, which both end at their shares.
3. **The spend table, the task's total and docs.** `close-key` already outputs the task's total and runs' costs from the ledger after its writes, so the closing task's `apply` shows its split cost, and each other task's at its next `apply` (decision 2). `close-key` logs the split. The spend table's Serverless note says that time shared with other runs is split, and later runs refresh it (English and Portuguese). Docs: [architecture](../architecture.md) (Choosing, Serverless, Spend, Budget, Backend's data layout and ledger), the agent job's comment in the task template, `action.yml`. Rebuild `dist/` and run `npm run check`. Done when they pass.

## End-to-end test

To be written by the implementer with the steps, covering two parallel tasks on one endpoint, whose costs add up to about the worker's billed time for those hours.

## Out of scope

- The live limit's double count (decision 3).
- Endpoints with more than one worker.
