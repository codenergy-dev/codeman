# Data layout

This page lists the documents Codeman keeps in its [backend](../glossary.md#backend): where each lives, which job writes and reads it, and its fields ([`src/store/layout.ts`](../../src/store/layout.ts)).

- What belongs to an organization, the repositories' owner, is under it: its runs and events, which the budgets read. A user account is its own organization.
- What a [pool](../glossary.md#pool-of-organizations) shares is under the pool, named by its ID ([pools](../runs/batches.md#pools)): the pod registry, the Serverless endpoints' runs, the board and the batches.
- The [cache of fits](../glossary.md#cache-of-fits) depends on no organization.
- One project can serve several organizations and pools.
- Owners, repositories and pools are lowercase, as GitHub compares them.

The [task record](../glossary.md#task-record) is not in the backend: it lives in the status comment on GitHub ([comments](../tasks/comments.md#the-task-record)).

## Overview

```text
organizations/{owner}                        the organization's pool declaration
├── runs/{run}                               ledger runs
├── events/{run}-{type}[-{subject}]          what the jobs did
└── pods/, contexts/, endpoints/             from before pools: history
pools/{pool}
├── pods/{nonce}                             the pod registry
├── board/{owner%2Fname}                     each repository's ready tasks
├── batches/{run}-{attempt}-{n}              batches on one pod
└── endpoints/{endpoint}/runs/{run}-{reservation}
                                             Serverless runs' billed times
contexts/{key}                               the cache of fits
```

## Collections

| Path | Written by | Read by | Lifetime |
| --- | --- | --- | --- |
| `organizations/{owner}` | `select`, which declares the organization's pool | The `select` of every member of the pool | Rewritten by each `select` |
| `organizations/{owner}/runs/{run}` | `select`, `open-key`, `close-key` | `open-key` (the reservation), `close-key` (the task's total, the split), and the job that records a pod's untracked time | Kept |
| `organizations/{owner}/events/…` | `select` and the [key jobs](../glossary.md#key-jobs) | No job: they are an audit | Kept |
| `organizations/{owner}/pods`, `contexts`, `endpoints` | No job any more | The budgets, for the older pods' untracked time | History from before pools ([upgrading](../installation/upgrading.md#gpu-batches-across-repositories)) |
| `pools/{pool}/pods/{nonce}` | `open-key` (claim, register, sweep), `close-key` and `release-pod` (leave), and the job that terminates the pod (untracked time) | `open-key`; the budgets, for untracked time | Kept, `live: false` once ended |
| `pools/{pool}/board/{owner%2Fname}` | `select`, which rewrites its repository's snapshot whole | The pool's `select`s | Read until `expiresAt`, 25 hours later |
| `pools/{pool}/batches/{run}-{attempt}-{n}` | `select` | `select`; `open-key`, for a pod's room | Read until `expiresAt`, 30 minutes after it forms; kept as history |
| `pools/{pool}/endpoints/{endpoint}/runs/…` | `close-key` | `close-key`, for the split | Kept |
| `contexts/{key}` | The `open-key` that created a pod, once the pod serves with a context it searched for | The `open-key` that creates a pod | Replaced on each search |

## Fields

### Organization

`organizations/{owner}`: one document per organization ([the handshake](../runs/batches.md#pools)).

| Field | Value |
| --- | --- |
| `pool` | The ID of the pool it declares |
| `members` | The pool's organizations |
| `declaredAt` | When `select` wrote it |

### Ledger runs

`organizations/{owner}/runs/{run}`: one [ledger run](../glossary.md#ledger-run) per agent run. Each phase adds its fields; the states are in [budget](../budget/budget.md#a-ledger-runs-states).

| Phase | Fields |
| --- | --- |
| Picked, by `select` | `repository` (`owner/name`), `task`, `workflowRun`, `attempt`, `month` (`2026-10`), `status: picked`, `pickedAt`, `stage`, `model`, `provider` (`openrouter`, `runpod-pod` or `runpod-serverless`), `profile`; `batch`, the [batch](../glossary.md#batch) of a pod's run; `key`, its batch key, whose open runs a [concurrency](../settings/profiles.md#concurrency) caps |
| Reserved, by `open-key` | `status: open`, `reservedAt`, `expiresAt`, `limit`; `carried`, on the task's first run in the ledger |
| Opened | `openedAt` |
| Refused | `status: refused`, `refusedAt`, `refusal` (the `open-key` status), `reason` |
| Failed | `status: failed`, `failedAt`, `reason`, and a `cost` of 0 |
| Closed, by `close-key` | `status: closed`, `closedAt`, `cost`, and when known `inputTokens`, `outputTokens`, `requests`, `maxInputTokens`, `tokensPerSecond`, `pod` and `podCost`, `endpoint` (Serverless) |
| Reopened | `spentBefore`, when `open-key` ran again after the run closed |
| Refreshed | A new `cost` or `podCost`; `status: expired` |

Only a refresh of an OpenRouter run's cost from its key writes `expired`. Other runs whose reservation expired stay `open`, and the budgets tell from `expiresAt`.

### Events

`organizations/{owner}/events/{run}-{type}[-{subject}]`: one document per thing a job did. Every event has `type`, `repository`, `task`, `run`, `workflowRun`, `attempt` (the job's), `job` and `at`, plus its type's own fields:

| Type | Own fields | Written by |
| --- | --- | --- |
| `task-picked` | `action`, `stage` | `select`, for every task it picks, also those without an agent |
| `key-opened` | `limit` | `open-key` |
| `key-refused` | `status`, `reason` | `open-key` |
| `key-failed` | `reason` | `open-key` |
| `pod-created`, `pod-joined`, `pod-terminated` | `pod`, also the subject; `reason` for a termination | The key jobs |
| `run-stopped` | `result`: the agent job's, when it did not succeed | `close-key` |
| `run-closed` | `cost` | `close-key` |

### Pod registry

`pools/{pool}/pods/{nonce}`: one document per pod Codeman created, named by the nonce of its admin token ([pods](../inference/pods.md#the-registry)). The task that takes the creation lease writes it before the pod exists.

| Field | Value |
| --- | --- |
| `settings` | The hash of the [pod settings](../glossary.md#pod-settings) |
| `model`, `gpuType`, `image`, `reuse` | What it serves |
| `provider` | `runpod`: the cloud that runs and bills the pod |
| `account` | The GPU account's fingerprint |
| `organization` | Its creator's |
| `capacity` | The runs it serves at once, when limited |
| `batch` | Its creator's batch |
| `key` | Its creator's batch key, whose live pods a [concurrency](../settings/profiles.md#concurrency) caps; absent from older pods, which count for none |
| `status` | `creating`, `serving`, `abandoned` or `ended` |
| `live` | Whether the registry holds it: until it ends |
| `claimedAt`, `claimedBy`, `creatingUntil` | The creation lease |
| `leases` | Each with `holder` (`owner/name#task`), `run`, `kind` (`run` or `keep`) and `until` |
| `seats` | The holders, by [seat](../glossary.md#seat) |
| `pod`, `createdAt`, `pricePerSecond` | Once the pod exists |
| `endedAt`, `reason` | Once it ends. For a failed start, `its start failed: ` and the gateway's reason, which the tasks that joined the pod fail with |
| `terminatedAt`, `month`, `lifeCost`, `counted`, `untracked`, `untrackedBy` | When a job terminated it: its [untracked time](../glossary.md#untracked-time), and each organization's share of it |

### Board

`pools/{pool}/board/{owner%2Fname}`: one snapshot of ready tasks per repository ([the board](../runs/batches.md#the-board)).

| Field | Value |
| --- | --- |
| `repository` | `owner/name` |
| `branch` | The default branch |
| `workflow` | Its Codeman workflow's file |
| `updatedAt`, `expiresAt` | When it was written, and until when it is read |
| `tasks` | Each with `number`, `stage`, `updatedAt` (the issue's), `since`, and `offers`: JSON text of each count's `tasks`, `profile` and `key` |

### Batches

`pools/{pool}/batches/{run}-{attempt}-{n}`: one batch of tasks on one pod, named by the workflow run that formed it ([forming batches](../runs/batches.md#forming-batches)).

| Field | Value |
| --- | --- |
| `key`, `profile`, `size` | What the batch serves, and its count |
| `formedBy` | `repository`, `workflowRun`, `attempt` |
| `formedAt`, `expiresAt` | When it formed, and until when it is read |
| `members` | Each with `repository`, `number`, and `status`: `reserved`, `started` or `dropped` |

### Cache of fits

`contexts/{key}`: one combination of a pod's image, model, GPU type and engine settings, by their hash (`fitKey` in [`src/inference/selfhosted.ts`](../../src/inference/selfhosted.ts)). It holds the context that fitted it, and no secret ([Ollama's memory](../settings/ollama.md#memory)).

| Field | Ollama | vLLM |
| --- | --- | --- |
| `image`, `model`, `gpuType`, `contextLength`, `modelContextLength`, `pod` (the pod that searched), `recordedAt` | Yes | Yes |
| `digest` | The model's, from Ollama | No |
| `ollama` | The variables, without `OLLAMA_CONTEXT_LENGTH` | No |
| `parallel` | The requests Ollama serves at once | No |
| `engine` | No | `vllm` |
| `vllm` | No | Its settings, without `max-model-len` |
| `concurrency`, `cacheTokens` | No | The requests of the context, and the tokens its K/V cache holds ([vLLM's memory](../settings/vllm.md#memory)) |
| `loads` | Ollama's loads | vLLM's starts |

### Serverless endpoint runs

`pools/{pool}/endpoints/{endpoint}/runs/{run}-{reservation}`: one Serverless run's time on the endpoint's worker, by the run and its reservation's time in milliseconds ([splitting](../inference/serverless.md#splitting-shared-worker-time)).

| Field | Value |
| --- | --- |
| `run`, `repository`, `task`, `reservedAt` | The run |
| `from`, `to` | The bounds of its billed times |
| `pricePerSecond` | The worker's price |
| `busy` | Its billed times, as JSON text of `[from, to]` pairs in milliseconds |
| `estimate` | Its gateway's estimate |
| `share`, `splitAt` | The last split's share, and when it ran |

## IDs

- A run's ID is `{workflow run}-{attempt}-{task}`: the [workflow run](../glossary.md#workflow-run), the attempt in which `select` picked the task, and the task.
- Workflow runs' IDs grow with time, so runs sort in the order they started.
- `select` gives the ID to the task's jobs, in its `ledger-run` output.
- A re-run of failed jobs keeps the attempt that picked the task, and so writes the same run. A re-run of the whole workflow picks again, as a new run.

## Queries and indexes

Firestore's automatic single-field indexes serve every query:

- The budgets' queries filter on equality only: an organization's or a repository's runs of a month, a task's runs, a pod's runs, and the pods that ended in a month.
- So does the count of a batch key's open runs, by `key` and `status`.
- So do the registry's: the pool's live pods, of some settings, of a batch key, or all.
- The split's query, an endpoint's runs whose times end after a moment, is a range on one field.
