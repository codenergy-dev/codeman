---
status: pending
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T14:56:15-03:00
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

The implementer refines these steps against the backend and the ledger as built, before starting.

1. The gateway's report of intervals and samples, in the agent job's output, within GitHub's output limits. Done when tests cover a run's report.
2. The split over the ledger's intervals per endpoint, and the recomputation at each close. Done when tests cover two runs that overlap, one that closes before the other, and runs of two repositories.
3. The spend table and the task's total read the split costs. Docs: [architecture](../architecture.md) (Serverless, Spend). Rebuild `dist/` and run `npm run check`.

## End-to-end test

To be written by the implementer with the steps, covering two parallel tasks on one endpoint, whose costs add up to about the worker's billed time for those hours.

## Out of scope

- The live limit's double count (decision 3).
- Endpoints with more than one worker.
