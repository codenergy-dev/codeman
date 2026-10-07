---
status: pending
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T14:56:15-03:00
commit: a8594ea
---

# Pod registry

## Goal

Codeman keeps its pods in a registry in Firestore, with leases taken in transactions, so the tasks that need a pod of the same settings find and share it without waiting or racing, across the organization's repositories, and a pod nobody holds is terminated.

## Context

- Depends on the [Firestore backend](2026-10-07-firestore-backend.md) and the [ledger budgets](2026-10-07-budgets-from-the-ledger.md).
- **Today.** `open-key` lists the account's pods, reads `CODEMAN_REPOSITORY`, `CODEMAN_TASK` and `CODEMAN_GROUP` from their environment, and asks each gateway its state; it terminates the repository's pods it does not recognize. Shared pods are found by a group key, a wait of 20 seconds per earlier task, and listing again; tasks that create at once may end with two pods ([pods](../architecture.md#pods), [shared pods](../architecture.md#shared-pods)). Pods of other repositories are never shared.
- **What stays.** The gateway in the pod splits each second among its runs and knows each run's share; a pod terminates itself when idle or unserved. The admin token is an HMAC of the GPU account key, so any job with that key manages any of the account's pods.

## Decisions

The responsible person approved the backend plan's recommendations on 2026-10-07, which this plan follows; the decisions below apply them, each with Codeman's recommendation.

1. **Finding or creating a pod.** Options:
   - (a) A document per pod settings (model, GPU type, image, `pod-reuse`) within the organization holds the pod that serves them, or a lease to create one. A task joins the pod, or takes the creation lease in a transaction and creates it; the others wait for the lease's pod, or take the lease once it expires.
   - (b) Keep today's search, with the registry only as a list of pods.

   Recommendation: (a). One creator per settings, no waits by position.

   **Answer:** (a).
2. **Sharing scope.** Options:
   - (a) The organization: any of its repositories' tasks with the same settings share a pod, since they share the Runpod account. Each run keeps its own token, limit and share.
   - (b) The repository.

   Recommendation: (a), which the responsible person asked for on 2026-10-07.

   **Answer:** (a).
3. **Keeping and releasing.** Options:
   - (a) A task that keeps a pod holds a lease on it, renewed by its runs and expiring after `pod-reuse`'s idle limit; a pod with no run and no lease is terminated by the job that leaves it so, and the pod's own idle timer stays as a backstop. Pods in the account that the registry does not hold, or whose leases all expired, are terminated by the next `open-key`.
   - (b) Keep `release-pod`'s current logic, with the registry as a record.

   Recommendation: (a). The `release-pod` job may become a lease release, or go.

   **Answer:** (a).
4. **Untracked time.** Options:
   - (a) A pod's time with no run and no keeper (after the last task left it) is recorded in the ledger for the organization, not a task or repository: it counts in the organization's month.
   - (b) To the last task that left it.

   Recommendation: (a). It is nobody's task, and the organization's month is where the account's time belongs.

   **Answer:** (a).

## Steps

The implementer refines these steps against the backend and the ledger as built, before starting.

1. The registry's documents and leases, with tests on the in-memory store: tasks that create at once (one pod), a creator that dies (its lease expires and another creates), a task of another repository joining.
2. `open-key`, `close-key` and `release-pod` on the registry; remove the environment-based search, the group key's waits, and the second listing. Done when the tests of shared pods pass on the registry and nothing reads `CODEMAN_GROUP`.
3. Orphan pods: pods the registry does not hold are terminated. Done when a test covers one.
4. Untracked time in the ledger, per decision 4.
5. Docs: [architecture](../architecture.md) (Pods, Shared pods, Spend), [installation](../installation.md). Rebuild `dist/` and run `npm run check`.

## End-to-end test

To be written by the implementer with the steps, covering: two tasks of one run on one pod; two repositories' tasks on one pod, each with its own share; a kept pod reused by the next run; a pod left by everyone terminated; and a pod created outside Codeman left alone, or terminated if it carries Codeman's environment.

## Out of scope

- Serverless endpoints, which Runpod scales by itself.
- Scheduling tasks across repositories (a queue of who runs next).
