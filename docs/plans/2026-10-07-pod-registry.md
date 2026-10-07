---
status: in progress
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T16:30:03-03:00
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

Refined on 2026-10-07 against the backend and the ledger as built ([backend plan](2026-10-07-firestore-backend.md), [ledger budgets plan](2026-10-07-budgets-from-the-ledger.md)). The steps keep the decisions; what they settle beyond them is marked **Choice**.

- **What is built on.** The store's transactions see the documents a query returns and those inserted into it, and run again when either changed ([`src/store/store.ts`](../../src/store/store.ts)); the ledger writes runs (`pod`, `podCost`) and events (`pod-created`, `pod-joined`, `pod-terminated`), and the organization's month reconciles the ledger's runs with Runpod's hourly billing ([`src/budget.ts`](../../src/budget.ts)). `open-key`, `close-key` and `release-pod` already have `id-token: write` and the GPU account key: no job gains a permission or a secret.
- **The pod image stays.** The gateway in the pod keeps its API: runs named by a task (`^\d{1,12}$`), keep and release, the split, and its timers. A run's task on the gateway becomes its *seat* on the pod, a number the registry gives each repository's task (below), so tasks of two repositories with the same issue number never share a seat, and `dist/gateway.js` does not change. Shared pods still need the image of the [parallel tasks plan](2026-10-06-parallel-tasks-and-inference-profiles.md) published and pinned (`POD_IMAGE`), which has not happened yet; until then every task gets a pod of its own, through the registry.

1. **The registry's documents and leases** ([`src/inference/registry.ts`](../../src/inference/registry.ts)), with tests on the in-memory store: tasks that create at once (one pod), a creator that dies (its lease expires and another creates), a task of another repository joining. Done when they pass, and when two claims at once on Firestore's emulator end with one creator.
   - **Choice: a document per pod, found by its settings.** `organizations/{owner}/pods/{nonce}`, named by the nonce of the pod's admin token, which the creator draws before it creates the pod. It holds the settings (`settings`, a hash of model, GPU type, image and `pod-reuse`; and the settings themselves, for people), `status` (`creating`, `serving`, `abandoned`, `ended`), `live` (held by the registry), the pod's ID, creation and price, the leases and the seats. A task finds the pod of its settings with a query (`settings` and `live`) in a transaction, which serializes creators as one document per settings would, and keeps a pod whose runs still hold it after another replaced it (abandoned), with its leases. A document per settings, holding only the current pod, would lose those leases.
   - **Claiming.** In one transaction, a task either joins the oldest `serving` pod of its settings (writing its lease), or sees another task's unexpired creation lease and waits, polling every 10 seconds, or takes the creation lease: a new document `creating`, with its own lease, expiring after 5 minutes. A creation lease that expired is ended (`ended`), so the next task takes over. The creator writes the pod's ID (`serving`) once the provider created it; if its lease was taken meanwhile, it terminates its pod and claims again.
   - **Leases.** One per task (`holder`: `owner/name#task`): `run` while a run is open, expiring after 2 hours as reservations do; `keep` from `close-key` with `pod-reuse: task`, expiring after the kept idle limit, 15 minutes. A pod with no unexpired lease is not held. Expired leases stay in the document, ignored, until the pod ends.
   - **Seats.** The registry gives each task a seat on the pod the first time it joins it, kept for the pod's life, which the gateway takes as the run's task.
   - **Done on 2026-10-07**: [`src/inference/registry.ts`](../../src/inference/registry.ts), `PodRegistry`: `claim` (join, wait or create, ending expired creation leases), `register`, `leave` (a keep lease or none; `onlyKeep` for a release; `abandon`), `end`, `live` and `change`, a transaction on one pod for the sweep (step 3); each transaction has 20 attempts, as reservations do. `LAYOUT.pods` and `LAYOUT.pod` in [`src/store/layout.ts`](../../src/store/layout.ts). Tests in `registry.test.ts`: three tasks that claim at once (one creator, the others join after with seats 2 and 3), a creator whose lease expires (the next task creates, and the late pod is refused), a task of another repository with its own seat and keep lease, the last leave and a release that ends only a keep lease, leases that expired, an abandoned pod, and other settings and organizations apart; `emulator.test.ts`, two claims at once on Firestore's emulator, one of which creates.
2. **The key jobs on the registry.** `open-key` claims and joins or creates; `close-key` ends the run on the gateway, then replaces its lease with a `keep` lease or drops it, and terminates the pod when no unexpired lease remains; `release-pod` releases the task on the gateway (for the split) and drops its `keep` lease, with the same rule. Remove the environment-based search, the group key (`podGroup`, `CODEMAN_GROUP`), the staggered waits, the second listing, the run's `others` and `sharePods` in the inference choice. Done when the tests of shared pods pass on the registry and nothing reads `CODEMAN_GROUP`.
   - **Choice: every pod is shared.** Decision 2 shares pods across the organization's repositories, so a pod's settings decide, not `parallel-tasks`: tasks with the same settings share a pod whether they run at once or one after another, and a kept pod serves the next task of any repository with them.
   - **Choice: images that serve one run at a time.** For an image in `SINGLE_RUN_IMAGES`, the settings' hash includes the task, so each task has a pod of its own and reuses it, through the same registry. Any other image must serve several runs: a pod whose gateway reports an older `version` fails the run (its creator terminates it) with a message that says to list the image, instead of the fallback to a pod per task, which a registry by settings cannot hold.
   - **Choice: a gateway that does not answer.** `close-key` drops its run's lease and marks the pod `abandoned`, so no task joins it; it terminates the pod only when no other lease holds it. A task that cannot join a pod does the same and claims again, which creates a new pod. Before, a shared pod whose gateway did not answer was terminated.
   - **Choice: a task's keep lease on other settings.** When a task opens a run on settings other than a pod it keeps (a model change, or another profile), `open-key` drops that `keep` lease, as it terminated the task's kept pod before; the pod ends if no other lease holds it.
   - **`release-pod` stays** (decision 3), as a lease release: without it a kept pod that no task will use costs its 15 idle minutes each time.
   - **Choice: a failed open.** A provider whose open fails reports the pods it created or terminated with the error (`OpenFailure`), so `open-key` records them, and their time (step 4), with the failure.
3. **Orphan pods.** Before claiming, a pod run's `open-key` lists the account's pods and reads the organization's live documents, then: ends a creation lease that expired; ends a pod whose leases all expired, or that the provider says stopped or failed, and terminates it; ends, without terminating, a pod the provider no longer has (it terminated itself); and terminates each pod that carries the organization's environment (`CODEMAN_ORGANIZATION`, or `CODEMAN_REPOSITORY` of one of its repositories, which pods created before the registry carry) and that no live document holds. Pods without that environment, or of another organization, are never touched. Each termination is logged with its reason and recorded as a `pod-terminated` event with that reason. Done when tests cover each case and a pod without Codeman's environment left alone.
   - **Choice: listing first.** The pods are listed before the documents are read, and a creator writes its document before it creates its pod, so a pod being created is always held by a document the sweep reads.
   - **Choice: only pod runs sweep**, since only their `open-key` has the GPU account key for sure.
   - **Choice: the change itself.** Pods created before the registry are orphans: update every repository of the organization at once.
4. **Untracked time** (decision 4). When a Codeman job terminates a pod, it records on the pod's document, for the organization: its life at its price (creation to termination), what the ledger's runs on it counted (`spentBy`, as the budgets count them), and the difference as `untracked`, with the `month` of its end. The organization's month (with `organization-monthly-budget`) adds each pod's untracked time of the month, spread over its life and reconciled with Runpod's hourly billing like the runs; repositories' months and tasks never count it. Done when tests cover a shared pod's leftover time in the organization's month and not in the repository's.
   - **Choice: everything no task counted.** The difference includes a task's kept time after its last close, which no task counts either, as well as the time with no run and no keeper; it errs on the side of the budgets.
   - **Choice: pods that terminate themselves** have no known end: their time counts through Runpod's billing, as before.
5. **Docs**: [architecture](../architecture.md) (Runs, Jobs, Choosing, Pods, Shared pods, Spend, Budget, Backend's data layout and ledger), [installation](../installation.md) (`parallel-tasks`, Pods, the change), [security](../security.md), [development](../development.md), `action.yml` and the task template's comments. Rebuild `dist/` and run `npm run check`. Done when they pass and `dist/gateway.js` is unchanged.

## End-to-end test

To be written by the implementer with the steps, covering: two tasks of one run on one pod; two repositories' tasks on one pod, each with its own share; a kept pod reused by the next run; a pod left by everyone terminated; and a pod created outside Codeman left alone, or terminated if it carries Codeman's environment.

## Out of scope

- Serverless endpoints, which Runpod scales by itself.
- Scheduling tasks across repositories (a queue of who runs next).
