---
status: in progress
created_at: 2026-10-29T16:54:04-03:00
updated_at: 2026-10-29T17:20:00-03:00
commit: 3d614ce
---

# Fall back to the next profile

## Goal

When several profiles can serve an agent run and the one the list prefers is unavailable, Codeman serves the run with the next one, in the list's order, until no compatible profile is left. For example, a cheap `salad-pod` profile at `priority: medium` first, and a `runpod-pod` or `openrouter` profile after it for when Salad has no seat or no node.

## Context

### How a profile is chosen today

- **One profile per count.** For a run's stage and its batch's [count](../glossary.md#count), `servingRun` (`src/settings.ts`) takes the first profile, in the list's order, whose conditions hold; the top level only when none does. `servedCounts` gives a task one [offer](../runs/batches.md#terms) per count, with that profile's batch key.
- **The count comes first.** `formBatches` (`src/batches.ts`) tries a task's offers from the largest count down. So the list's order decides only among profiles that hold at the same count:

  | Profiles, in order | 3 code tasks ready | Takes |
  | --- | --- | --- |
  | `salad` (`max-tasks: 1`), then `runpod` (`max-tasks: 3`) | Count 3 holds only for `runpod` | One batch of 3 on `runpod`, though `salad` is first |

- **No fallback.** The other profiles that hold at the same count are never tried:

  | When the chosen profile | Today | Where |
  | --- | --- | --- |
  | Has every [instance](../glossary.md#instance) busy (`concurrency`) | The task waits for a seat | `select` (`seats` in `src/steps/select.ts`) |
  | Lost the seat to another run between `select` and `open-key` | Refused as `concurrency-reached`; the task goes back and the next run makes it wait | `open-key`, `apply` (`chains`) |
  | Cannot get a pod now: Runpod has no room on the allowed clouds, no host with vLLM's CUDA has room, or Salad allocates no node | `open-key` fails; the task is **blocked** with "no key" | `#launch` and `#attach` in `src/inference/selfhosted.ts` |
  | Loses its pod mid-run (a Salad node preempted or gone) | The stage fails | The agent job |

- **The profile travels by count.** `prepare` (`src/steps/select.ts`) and the honoring of [reservations](../runs/batches.md#reservations) resolve a started task's settings again with `resolveRun(layers, { stage, tasks })`, which picks the first profile that holds. A fallback needs them to resolve the profile the batch was formed for.

### What tells that a provider has no room

| Provider | Sign | Recorded in |
| --- | --- | --- |
| `runpod-pod` | The catalog's `availability` is `NONE` on a cloud; a create answers `400`, the only sign of no capacity, which a request that breaks a rule also gives | [Create a pod](../web/runpod/create-a-pod.md#errors) |
| `runpod-pod`, vLLM | No host with the GPU and CUDA 13.0 has room (`#prepareVllm`) | `src/inference/selfhosted.ts` |
| `salad-pod` | The group stays allocating, with no running instance; nothing is billed meanwhile | [Troubleshooting](../web/salad/troubleshooting-salad-container-engine-workloads.md), [pricing](../web/salad/saladcloud-pricing.md) |
| `openrouter`, `runpod-serverless` | None at `open-key`: a key or a reservation always opens. Errors come during the run | – |

A pod's start may take up to `START_MINUTES` (25) in all. A Salad group stuck allocating uses that whole time today, then fails the task.

### What the registry already keeps

A pod's registry document stays after it ends, with `endedAt`, `reason` and the batch `key` ([data layout](../backend/data-layout.md#pod-registry)). Joiners already read a failed start from `reason`'s prefix (`its start failed: `, [plan](2026-10-22-fail-the-tasks-waiting-for-a-failed-pod.md)). `select` already reads the pool's live pods by key (`PodRegistry.instances`).

### The Salad example

Salad says an instance at `medium` or `low` runs roughly 30 minutes before it can be reallocated ([pricing](../web/salad/saladcloud-pricing.md)). `agent-minutes: 20` and `wrap-up-minutes: 10` do not by themselves keep a run within it:

- The instance runs while the pod downloads the image and loads the model, before the agent starts.
- A pod is shared: another batch of the same settings joins a pod with room, and `pod-reuse: task` keeps it for the task's next stage.

So for this example a profile also wants `pod-reuse: run` and a count of 1, and a run can still be preempted. Surviving a preemption is out of scope.

## Decisions

Answered on 2026-10-29: the recommendations of decisions 1 to 4 are accepted. Decision 5 was not asked: it keeps how a task waits for a seat today, so its recommendation is taken, and the responsible person may revisit it.

### 1. The order: the count or the list

| Option | Trade-off |
| --- | --- |
| A. The list first: a task tries its offers by the profile's place in the list, then each profile's counts from the largest down. A profile is the next one's fallback, whatever their counts | "Top to bottom" holds literally, and the cheaper profile is preferred even when a later one would take a larger batch. A list that relied on the largest count winning changes |
| B. The count first, as today; fallback only among profiles that hold at the same count | No change to which batch forms when every profile is free. The example in the Context still prefers `runpod` |

**Recommendation:** A. The documented example in [profiles](../settings/profiles.md#example) forms the same batches either way. Offers on the board carry their place; an older snapshot's offers keep the count order.

**Answer:** A.


### 2. Which settings are fallbacks

| Option | Trade-off |
| --- | --- |
| A. Every profile whose conditions hold, in the list's order, then the top level when it has a `model`. Always on | What was asked. Tasks that waited for a seat on their profile now run on the next one: an installation that relied on waiting must narrow the later profiles' conditions |
| B. As A, but the top level only when no profile holds, as today | A top-level model is never used to relieve a busy profile |
| C. Opt-in: a top-level `fallback: true`, off by default | No change for current installations; one more setting |

**Recommendation:** A. Each profile keeps its own `concurrency` and the budgets bound the total. [Upgrading](../installation/upgrading.md) states the change.

**Answer:** A.


### 3. What makes a profile unavailable

| Option | Trade-off |
| --- | --- |
| A. Its seats are all busy (`select`), or its provider has no room for a pod now (`open-key`): Runpod's catalog says `NONE` on every allowed cloud, or its create answers `400`; no host has vLLM's CUDA with room; a Salad group has no running instance after an allocation limit (decision 4) | Covers the asked cases. A Runpod `400` that is really a rule violation also falls back, and its reason is logged |
| B. Busy seats only | Simplest; a Salad group stuck allocating still blocks the task after 25 minutes |
| C. A, plus a pod lost mid-run, which reruns the stage on the next profile | Covers preemption, but a stage that ran halfway changed the branch; much larger |

**Recommendation:** A. Errors that are mistakes in the settings (a model that does not fit, an image that cannot serve) still fail the task: another profile would hide them.

**Answer:** A.


### 4. How `open-key`'s unavailability reaches `select`, and for how long

| Option | Trade-off |
| --- | --- |
| A. `open-key` ends the pod's registry document with `reason` starting `unavailable: `, and refuses the run as `profile-unavailable`, at no cost: the task goes back to its previous state, not blocked, and the next run starts at once, as with `concurrency-reached`. `select` counts a key as having no seats for 15 minutes after such an end, in the pool. A Salad group with no running instance after 10 minutes is deleted, and so ends | No new field nor collection: `reason` already exists and `select` already reads the registry. One extra run per fallback |
| B. `open-key` falls back itself to the next profile, in the same job | No extra run, but the task's context, batch, model and agent time were set by `select` for the first profile, and a batch across repositories would split |
| C. A new collection of unavailable profiles, with their own expiry | Clearer to read, but a storage schema change for what the registry already says |

**Recommendation:** A. The 15 and 10 minutes are constants, documented, not settings, until a need shows.

**Answer:** A.

### 5. When every compatible profile is unavailable

| Option | Trade-off |
| --- | --- |
| A. The task waits, its panel naming why, such as "Waiting: profile `salad` has no room until 17:20, and profile `runpod`'s one instance is busy." Every run checks again; waiting starts no run, as today | Consistent with waiting for a seat. A task may wait until another event or the daily schedule |
| B. As A, plus `apply` schedules a run when the earliest mark expires | Moves sooner, but needs a timer GitHub Actions does not offer cheaply |

**Recommendation:** A.

**Answer:** A, as recommended (not asked).

## Steps

Each step ends with `npm run check` passing, and is one commit.

1. **Offers per profile.** `servedCounts` gives, for each count, one offer per profile that holds, then the top level when it has a model (decision 2), each with its place in the list; `resolveRun` accepts the profile to resolve, so `prepare` and the honoring of reservations resolve the batch's own profile. Done when `src/settings.test.ts` covers two profiles at one count, the top level after them, and a named profile.
   - **Done on 2026-10-29.** `servingRuns`, `ServingChoice` and `place` in `src/settings.ts`; `prepare` and the waiting panel resolve the batch's profile. Until step 2, batches still prefer the largest count, now with the fallbacks at each count.
2. **Forming in the list's order.** `formBatches` tries a task's offers by place, then count (decision 1), skips a key without seats, and says, for a task that waits, every profile that could have served it and why. Older board offers, without a place, keep the count order (`src/batches.ts`, `src/board.ts`). Done when `src/batches.test.ts` and `src/board.test.ts` cover a busy first profile served by the second, a free first profile preferred over a larger batch of the second, and all of them busy.
3. **Unavailable pods.** The pod providers throw an `Unavailable` error for decision 3's signs (`src/inference/provider.ts`, `runpod.ts`, `selfhosted.ts`); a Salad start without a running instance after 10 minutes is one. `#create` ends the document with `unavailable: `, and joiners that find it so throw it too. `PodRegistry.instances` reports the keys with such an end in the last 15 minutes. Done when `src/inference/runpod.test.ts`, `selfhosted.test.ts` and `registry.test.ts` cover each sign, a joiner, an expired mark, and a rule-breaking create.
4. **Refusing and going back.** `open-key` refuses an `Unavailable` as `profile-unavailable`; `apply` returns the task to its previous state and chains the next run; `select` counts a marked key as without seats, and words the waiting panel in `src/i18n/en.ts` and `pt-BR.ts` (`src/steps/keys.ts`, `apply.ts`, `select.ts`). Done when `src/steps/keys.test.ts`, `apply.test.ts` and `flow.test.ts` cover it.
5. **End to end.** Two scenarios: a task whose first profile, a pod at `concurrency: 1`, is busy runs on the second, an OpenRouter profile (`profiles/fallback-busy`); a task whose fake Runpod has no room is refused, then runs on the second profile in the next run (`profiles/fallback-unavailable`). Done when they and the `parallel`, `pods` and `pools` scenarios pass.
6. **Docs.** [Profiles](../settings/profiles.md) (which applies, fallback, waiting), [batches](../runs/batches.md#forming-batches), [pods](../inference/pods.md#creating), [Salad installation](../installation/salad.md) (the 30 minutes, with this plan's example), [budget outcomes](../budget/budget.md#outcomes-of-open-key), [data layout](../backend/data-layout.md#pod-registry) (`unavailable: `), the [glossary](../glossary.md) (fallback), and an [upgrading](../installation/upgrading.md) entry for decisions 1 and 2. Done when `src/docs.test.ts` passes.
7. **Build.** Rebuild `dist/`. Done when CI's build check passes. The gateway does not change, so no pod image is published.

## Out of scope

- Rerunning a stage on another profile after its pod was lost mid-run (decision 3, C).
- Fallback on OpenRouter or Serverless errors during a run, such as a model OpenRouter cannot route.
- Fallback for a stage whose batch cannot be completed at any count: that task waits for tasks, as today.
- Settings for the 15 and 10 minutes.
- Choosing a profile by price; the list's order is the only preference.
