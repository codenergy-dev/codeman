# Batches across repositories

A profile's count (`tasks`, `min-tasks`, `max-tasks`) is the size of a batch: the tasks that run at once with the same resolved settings. On a pod, a batch may take tasks of several repositories, and of several organizations of a pool: 2 tasks ready in one repository and 2 in another form a batch of 4 on one GPU, each running in its own repository's workflow and counting against its own organization's budget. On OpenRouter and Serverless, a batch is the tasks of one run that take the profile. The choice was made in the [plan for GPU batches across repositories](../plans/2026-10-13-gpu-batches-across-repositories.md).

GitHub stays the source of truth of tasks. The board and the batches, in [Codeman's store](../backend/data-layout.md), are an index: at worst an inconsistency makes a batch smaller; it never runs a task that should not run.

## Pools

A pool is a closed list of organizations that share the board, the batches, the [pod registry](../inference/pods.md) and the Runpod account. Without the `pool` setting, an organization is a pool alone.

- `pool` is set only in the organization's settings (`CODEMAN_SETTINGS`), as a list of 1 to 10 logins that includes the organization itself: `pool: [organization-a, organization-b]`. Anywhere else, or without the organization, it stops the run.
- The pool's ID is its members' logins, lowercase, sorted, joined by `+`: `organization-a+organization-b`. Alone, it is the organization's login.
- **The handshake.** Each `select` writes the pool it declares on its organization's document (`organizations/{owner}`: `pool`, `members`, `declaredAt`), and batches with another member only when that member's document declares the same pool. Otherwise it warns once per run, such as "Organization organization-b declares pool `organization-b`, not `organization-a+organization-b`: its repositories are not batched with this one's." Neither side can pull the other in.
- A pool shares one Runpod account: a pod's admin token derives from the account's key, so only that key's jobs can join or end it. Each organization keeps its own budgets.
- Codeman never lists the App's installations: it mints tokens only for owners its pool names and that agree on it.

## The board

Each `select` rewrites its repository's snapshot whole (`pools/{pool}/board/{owner%2Fname}`), in one transaction with the batches:

- its ready tasks that a pod profile could serve, in its own order of priority, each with its stage, the issue's last update, `since` (when the board first listed it ready, carried from the previous snapshot), and its offers: each count at which a profile serves it, with the profile and a key of the settings that serve it there;
- `expiresAt`, 25 hours later: the daily schedule rewrites it, and the `issues` triggers rewrite it whenever the `codeman` label changes or a task closes or reopens.

The tasks the run starts, and those no pod serves, are left out.

## Forming batches

After honoring its reservations (below), a `select` forms every batch the board of the members that agree completes, whether its own tasks are in it or not:

1. **Candidates.** Its own ready tasks, read from GitHub this run, and the other snapshots' tasks that no unexpired batch holds.
2. **Priority.** Oldest `since` first, then by repository, then by each repository's own order (planning before stages).
3. **Forming.** In that order, the first task that some offer completes takes the largest such count n, with the first n tasks offering the same count and key; then the next. A count on OpenRouter or Serverless is completed only by the forming repository's own tasks.
4. **Limits.** The run's own tasks fit in the run's cap, after the tasks without an agent and the reserved ones; another repository's reserved tasks are at most 10.
5. **Documents.** Each batch on a pod gets `pools/{pool}/batches/{run}-{attempt}-{n}`: its count, key and profile, who formed it, `expiresAt` 30 minutes later, and each task as `started` (the forming repository's) or `reserved` (the others').

A task that no batch of its count completes waits; its panel says how many are ready, and where: "Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are, in 2 repositories."

## Reservations

- A reservation belongs to the repository, not to the dispatched run: whichever `select` of that repository comes first honors it.
- That `select` checks each reserved task against GitHub: still ready, with the batch's count and key among its offers. It starts those (`started`), resolving their profile with the batch's count, and drops the others (`dropped`), which releases their seat on the pod.
- After 30 minutes, a batch's tasks still `reserved` return to the board, and the batch runs smaller.

## Waking the other repositories

`select` outputs `dispatches`: one entry per other repository with tasks in a batch it formed, only for owners in the pool that agree. A dispatch always starts the target's `codeman.yml` on its default branch, the only workflow Workload Identity admits: the token may start any of the target's workflows, so nothing on the board, which any member's run may write, chooses what a dispatch starts. The `dispatch` job, one leg each, mints a token for that owner limited to that repository, `actions: write` and `metadata: read` (gh reads the repository's default branch with it), logs whether that repository's `codeman` group is busy, and starts its workflow with `workflow_dispatch`, the batch IDs as its `batch` input, which the started run only logs. The dispatched run waits in that repository's `codeman` group like any other.

A dispatch that is refused (the App is not installed on the repository, its permission is not approved, the installation is suspended, the workflow is missing or disabled) fails its leg, visibly in the forming run; the reservation expires after 30 minutes, and the forming repository's tasks run on their pod meanwhile.

## On the pod

The tasks of a batch carry its ID to `open-key`, and the pod the first of them creates records it. A pod takes runs only while its unexpired run leases and the tasks its batch reserved that have not joined are fewer than its parallel requests; a task of its batch always joins it, and a task that finds every pod of its settings full creates another ([pods](../inference/pods.md#shared-pods)).
