---
status: in progress
created_at: 2026-10-29T08:02:44-03:00
updated_at: 2026-10-29T08:45:00-03:00
commit: b60b66a
---

# Limit how many instances of a profile run at once

## Goal

A `concurrency` setting, at the top level and in each profile, caps how many instances of it run at once, 1 by default: pods on Runpod pods, batches of agent runs on OpenRouter and Serverless. It brakes how fast spend grows as tasks are created and progress: tasks beyond the cap wait instead of creating another pod or opening more runs.

> [!NOTE]
> A first version of this plan capped only pods (`max-pods`). On 2026-10-29 the responsible person asked for one cap on every provider, as a brake on spend; the decisions below replace that version's.

## Context

How it works today:

- A profile's count (`tasks`, `max-tasks`) is the size of a [batch](../glossary.md#batch). A run's cap is the largest count of any profile; one run per repository is active at a time ([runs](../runs/runs-and-jobs.md#which-tasks-a-run-takes)).
- **Pods.** A pod's [capacity](../glossary.md#capacity) is its profile's count. `open-key` claims a pod in one store transaction (`PodRegistry.claim`, `src/inference/registry.ts`): it joins a pod with room, waits for one being created, or creates one. **A task that finds every pod full creates another**, without bound.
- **OpenRouter and Serverless.** Each task of a batch opens its own run. Nothing bounds how many run at once beyond each repository's run cap, so a pool or an organization of many repositories runs as many at once as they have ready tasks.
- `select` never reads the pod registry nor the open runs. It forms batches from its own tasks and the pool's [board](../runs/batches.md#the-board).

So spend grows with the work:

| Settings | Ready tasks | At once today |
| --- | --- | --- |
| A pod profile with `max-tasks: 1`, and another profile with `tasks: 4` (run cap 4) | 4 tasks served by the first | 4 pods |
| A pod profile with `max-tasks: 2`, in a pool of 3 repositories | 2 ready tasks in each | Up to 3 pods |
| An OpenRouter profile with `max-tasks: 2`, in 5 repositories | 2 ready tasks in each | 10 runs |

What Codeman stores, which a cap can count:

| Provider | Where a running instance shows | Scope |
| --- | --- | --- |
| `runpod-pod` | Live pods in the pod registry (`pools/{pool}/pods`), with their settings hash, capacity and leases | The [pool](../glossary.md#pool-of-organizations) |
| `openrouter`, `runpod-serverless` | [Ledger runs](../backend/data-layout.md#ledger-runs) with `status: open` and an unexpired `expiresAt`, with `profile` and `provider` | The organization (`organizations/{owner}/runs`) |

Constraints:

- **Who enforces.** Only `open-key` reads and writes the registry and the ledger in one transaction with its claim or reservation. What `select` reads can be stale by the time `open-key` runs.
- **Identities.** `select` knows each task's batch key (`batchKey`, `src/settings.ts`): the profile and what serves it. Pods are shared by another hash (`podSettingsKey`), which holds no profile, so two profiles with the same settings share pods. Neither pods nor ledger runs record the batch key today.
- **Waking a waiting task.** A task that waits starts no run ([the next run](../runs/runs-and-jobs.md#the-next-run)). It is picked again by its repository's next run, or, on a pod, by another member's `select` that completes a batch from the board. A task `select` started is off the board until its repository's next `select`.
- **Serverless** endpoints already have exactly 1 worker ([endpoint requirements](../inference/serverless.md#endpoint-requirements)): the cap bounds the runs that share it, not workers.
- **Profiles change only inference and agent time** ([profiles](../settings/profiles.md#what-a-profile-sets)). A cap belongs with them: each profile is a provider, a model and a price.
- **Behavior change.** A default of 1 caps installations that run several pods, or several batches, of one profile today. Upgrading must say so.

## Decisions

Answered on 2026-10-29: every recommendation is accepted.

### 1. The setting

| Option | Trade-off |
| --- | --- |
| A. `concurrency`, a whole number from 1 to 10, default 1, at the top level and in profiles. Set in the organization's and the repository's settings only, not by a manual run's inputs nor a task's command. A profile without it inherits the top level's; each profile counts its own instances | One name for every provider, as asked. A task cannot raise a shared brake. Inheriting lets one top-level value brake every profile |
| B. The same, but a profile without it gets 1, not the top level's | Each profile's brake is explicit, but changing every profile takes one line each |
| C. `max-pods` on pods only (the first version) | Leaves OpenRouter and Serverless without a brake |

**Recommendation:** A. 10 is Codeman's cap on tasks (`MAX_TASKS`).

**Answer:** A.

### 2. What one instance is

| Option | Trade-off |
| --- | --- |
| A. An instance is what serves one batch: a pod on `runpod-pod`; on OpenRouter and Serverless, as many open runs as the profile's most tasks (`mostTasks`). So `concurrency: 2` allows 2 pods, or 2 × `max-tasks` open runs | The default of 1 keeps every profile's count working: a `tasks: 4` profile still runs 4 tasks at once, on one pod or in 4 runs. On a pod it bounds what is billed, the pod, whatever runs on it |
| B. An instance is one agent run, on every provider | Simplest to read, but the default of 1 would serialize every profile with a count above 1, and on a pod it bounds runs, not the pods that are billed |

**Recommendation:** A.

**Answer:** A.

### 3. Which instances count together

| Option | Trade-off |
| --- | --- |
| A. Those of the same batch key, a profile with the same resolved settings: live pods (`creating`, `serving`, `abandoned`, which still bills) in the pool; open runs in the organization. Pods and ledger runs record the key (decision 5) | The key `select` already forms batches by. A task's `/codeman set model` or `gpu` makes another key, with its own cap. A pod created for one key can still be joined by another key with the same pod settings: sharing only lowers the count of pods |
| B. Those of the same profile name, whatever its settings | Matches "the profile" literally, but repositories of a pool may give one name different settings, and the top level has no name |
| C. Pods by pod settings hash, runs by profile name | No new field on pods, but two identities that `select` cannot match |

**Recommendation:** A. Scopes follow where each is stored: pods are shared across the pool, while OpenRouter keys and the ledger are per organization. So two organizations of a pool each get their own cap on OpenRouter and Serverless.

**Answer:** A.

### 4. What `open-key` does at the cap

| Option | Trade-off |
| --- | --- |
| A. **Pods:** join a pod with room, or wait for one being created, as today; when neither and the key's live pods are at the cap, refuse at once. **OpenRouter and Serverless:** in the reservation's transaction, refuse at once when the key's open runs are at the cap. Either way, the run is refused as `concurrency-reached`, at no cost, and the task goes back to its previous state, as with `over-budget`. Not blocked | A seat frees only when a whole agent run ends, so waiting minutes rarely helps. Uses no runner time |
| B. Wait for a seat, up to `open-key`'s limit (35 minutes), then refuse | More chances, but holds a runner per waiting task |
| C. Fail, and block the task | A busy profile is not a mistake to fix |

**Recommendation:** A. With decision 5, this happens only in races between runs.

**Answer:** A.

### 5. Whether `select` holds tasks back

| Option | Trade-off |
| --- | --- |
| A. `select` counts each key's free seats before it forms batches, and forms none that do not fit. Pods: each live pod's room, plus `concurrency` minus the live pods, times the capacity. OpenRouter and Serverless: `concurrency` × most tasks, minus the open runs. A task held back waits, its panel saying "Waiting for profile `small-pod`: 2 of 2 instances are busy." For that, `open-key` records `key` on the pods it creates, and `select` records `key` on the ledger runs it picks | No runner spent on tasks that would be refused. Two new fields, in the pod registry and the ledger, and two reads in `select`. Approximate across concurrent `select`s; `open-key` stays the authority |
| B. Only `open-key` enforces | No schema change, but every extra task starts its jobs and is refused, run after run |

**Recommendation:** A.

**Answer:** A.

### 6. How a refused task is picked again

| Option | Trade-off |
| --- | --- |
| A. `apply` counts a `concurrency-reached` refusal as moved for `next-run` only. The repository's next `select` then holds it back as waiting (decision 5) and, on a pod, lists it on the board, where any member's next `select` completes a batch with it once a seat frees | Never stranded off the board. One extra run, which moves nothing and stops; another refusal needs another race |
| B. Not moved: it waits for the next run some event starts | No extra run, but on a pod it is off the board meanwhile, and it may wait until the daily schedule |

**Recommendation:** A. On OpenRouter and Serverless, the next run of the repository whose runs hold the seats picks only its own tasks; a waiting task of another repository moves on its own repository's next event. Waking it is out of scope.

**Answer:** A.

## Steps

1. **Setting.** Add `concurrency` (`src/settings.ts`): whole number, 1 to 10, default 1, at the top level and in profiles, inherited by profiles; refused in a manual run's inputs and a task's commands. Not part of the pod settings hash nor of the batch key. Done when `src/settings.test.ts` covers the default, the bounds, inheritance, a profile's override, and both refusals.
2. **Keys on records.** `select` writes `key` on the ledger runs it picks (`src/ledger.ts`); `open-key` writes `key` on the pods it creates (`src/inference/registry.ts`). Done when their tests read the field back, and documents without it count as no key.
3. **Pods.** `PodRegistry.claim` takes the key and the cap: when no pod has room, none being created has room, and the key's live pods are at the cap, it returns `{ kind: "full" }` and writes nothing. `open-key` refuses as `concurrency-reached` (`src/inference/selfhosted.ts`, `src/steps/keys.ts`). Done when `src/inference/registry.test.ts` covers joining under the cap, refusing at it, an expired creation lease that frees a place, and abandoned pods counting.
4. **OpenRouter and Serverless.** The reservation's transaction counts the organization's open, unexpired runs of the key, and refuses as `concurrency-reached` at `concurrency` × most tasks (`src/ledger.ts`, `src/steps/keys.ts`). Done when `src/ledger.test.ts` covers under the cap, at it, and an expired run that no longer counts.
5. **`apply`.** A `concurrency-reached` refusal returns the task to its previous state and uploads the chain artifact (`src/steps/apply.ts`). Done when `src/steps/apply.test.ts` covers it.
6. **`select`.** Read the pool's live pods and the organization's open runs, give `formBatches` (`src/batches.ts`) the free seats per key, and report tasks held back as waiting, with the message in `src/i18n/en.ts` and `src/i18n/pt-BR.ts` (`src/board.ts`, `src/steps/select.ts`). Done when `src/batches.test.ts` and `src/board.test.ts` cover a full key, a key with seats left, a kept pod that takes the next batch, and an OpenRouter profile at its cap.
7. **End to end.** Two scenarios with `concurrency: 1`: two batches of one on a pod, where the second waits and then runs on the same pod; and two OpenRouter tasks of a `max-tasks: 1` profile, where the second waits for the first ([scenarios](../development/e2e/scenarios.md)). Done when `npm test` and the e2e suite pass.
8. **Docs.** Update the [settings reference](../settings/reference.md), [profiles](../settings/profiles.md), [runs](../runs/runs-and-jobs.md#which-tasks-a-run-takes), [batches](../runs/batches.md), [pods](../inference/pods.md#capacity), [OpenRouter](../inference/openrouter.md), [Serverless](../inference/serverless.md), [budget outcomes](../budget/budget.md#outcomes-of-open-key), [data layout](../backend/data-layout.md) (both new fields), the [glossary](../glossary.md) (instance), and an [upgrading](../installation/upgrading.md) entry: with the default of 1, a profile that ran several pods or batches at once now runs one, unless it sets `concurrency`. Done when `src/docs.test.ts` passes.
9. **Build.** Rebuild `dist/`. Done when CI's build check passes.

## Out of scope

- A cap across profiles, or on a whole pool, organization or account.
- One cap shared by the organizations of a pool on OpenRouter or Serverless.
- Waking another repository's waiting task when a seat frees, in `close-key` or `release-pod`.
- Terminating pods or cancelling runs above a lowered cap: it takes effect as they end.
- Pods on images that serve one run at a time, whose settings hash holds the task.
- A cap in money; the [budgets](../budget/budget.md) already bound spend.
