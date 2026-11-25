---
status: pending
created_at: 2026-11-25T19:00:00-03:00
updated_at: 2026-11-25T19:00:00-03:00
commit: 3fc6d2d
---

# Serve several models in one pod

## Goal

One pod serves several [services](2026-10-30-investigate-multi-service-pods.md#terms), each an engine with a model, so that a task whose stages use different models keeps one pod. A supervisor, grown from the gateway, loads each service when a run asks for it, and keeps the services loaded together or swaps them, as the fit decides. This is part 2a of the multi-service pods work (decision 1).

## Context

### Where it comes from

- **The [investigation](2026-10-30-investigate-multi-service-pods.md#decisions)** decided the direction, and its experiments proved a supervisor on CPU ([E2](2026-10-30-investigate-multi-service-pods.md#e2-a-supervisor-of-several-services), commit `9c822d8`):
  - **Decision 1:** the supervisor lives in the pod.
  - **Decision 2:** services coexist or swap, by the fit; a pod that swaps takes one task.
  - **Decision 3:** a task joins any pod whose manifest contains its services (superset).
  - **Decision 4:** one adapter per engine family.
  - **Decision 5:** cost stays split evenly; the supervisor measures each run's occupancy.
  - **Decision 6:** resolve outside, verify inside.
  - **Decision 7:** the primary engine is the pod's image; only secondary engines are downloaded.
- **[Part 1](2026-10-30-start-pods-from-official-engine-images.md)** delivered what this plan builds on: official images, the bootstrap, the [release policy](../security/release-policy.md), the pod's `resolution`, and the [fit estimate before creation](2026-11-23-estimate-the-fit-before-creating-a-pod.md).

### What a pod is today

A pod serves one engine and one model. Its [pod settings](../glossary.md#pod-settings) are hashed, and only tasks with the same hash share it ([pods](../inference/pods.md#shared-pods)). A profile serves the stages it names ([profiles](../settings/profiles.md#conditions)). So a task with a profile for `plan` and `review` on one model, and another for `code` on a second model, uses two pods, even on the same GPU type, provider and hosts.

### What changes

| Today | After this plan |
| --- | --- |
| One service per pod | A [manifest](2026-10-30-investigate-multi-service-pods.md#terms) of services: the primary, from the image's engine, and secondaries |
| The gateway starts one engine and gives it the GPU | The supervisor starts the primary, and loads the secondaries on demand, within a memory budget |
| A pod matches only the same pod settings | A pod matches a task whose services are all in its manifest |
| `open-key` estimates one model's fit | It estimates the manifest's fit: coexist, swap, or refuse before creating the pod |
| A pod's capacity is its engine's parallel requests | When services coexist, the smallest of theirs, since a task may use any of them across its stages. When they swap, one task |
| The gateway measures each run's share of the pod's time | It also measures each run's occupancy per service: busy seconds, waiting seconds, and GB-seconds |

The pod is healthy once its primary serves, within the [start timer](../inference/pods.md#timers) as today. Secondaries download in the background from the start, and load on their first request: "download early, load late".

### Requirements carried over

- **The whole tree's minimum age** for any engine installed by package, not from an image ([decision 13 of part 1](2026-10-30-start-pods-from-official-engine-images.md#decisions)). For Ollama's Linux release (decision 2), that means its Go modules. Its bundled C and CUDA libraries have no dates to check ([E3](2026-10-30-investigate-multi-service-pods.md#e3-resolving-outside-with-the-policy)).
- **vLLM 0.32.0 needs CUDA 13.0 or newer,** which narrows the hosts any manifest with vLLM can start on ([the e2e plan's progress](2026-11-04-run-e2e-on-github-runners.md#progress)).
- **A vLLM pod takes about 8 minutes to serve** on a fresh host. A vLLM secondary adds its own load to the first request that needs it.
- **vLLM's sleep mode needs `VLLM_SERVER_DEV_MODE=1`,** whose routes must stay on the pod's loopback, behind the supervisor ([sleep mode](../web/vllm/sleep-mode.md)).
- **A request held through a swap** must not outlast Runpod's proxy, which cuts a request after 100 seconds. Streams are kept alive with SSE comments ([E2](2026-10-30-investigate-multi-service-pods.md#e2-a-supervisor-of-several-services)); a non-streamed request is not, so the swap times measured in step 2 bound it.
- **Salad's open assumptions 1 and 7** ([Salad's handover](2026-10-29-add-salad-pods.md#handover)) still decide whether a pod that ends itself stays ended. The live test confirms them before this plan's pods run on Salad.
- **Two lessons of E2:**
  - A Python engine's load is mostly the start of its process. A service therefore has three states, not two: stopped, running with its weights unloaded, and loaded.
  - Loads that fit together must not wait on one lock.

### Changes that need approval

| Change | Kind | Where |
| --- | --- | --- |
| A new settings key that groups profiles on one pod | Public interface (`CODEMAN_SETTINGS`, `.codeman/settings.yml`) | Decision 3 |
| The pod's document gains its manifest; the ledger's run gains its occupancy | Storage schema, additive | Steps 6 and 9 |
| A `measure` check in the pod check, named in `e2e.yml`'s input | CI, and money: about $0.20 to $0.40 per dispatch | Decision 4 |
| `proxy.golang.org`, to date Ollama's Go modules | New external service | Decision 2 |

## Decisions

1. **Scope: one plan or two.** Everything the investigation covered is too much for one plan. The Python engines alone bring an interpreter, wheel sets, `pip` and a whole-tree check over hundreds of packages.
   - **Options:**
     - (a) **This plan is part 2a:** the supervisor, text services, the settings, superset matching and the measurements. **Part 2b** comes later: Python secondary engines (`python-build-standalone` and wheel sets), image and video generators, the tool the agent calls to generate, and stages that use them.
     - (b) One plan for all of it.
   - **Recommendation:** (a). Part 2a has a consumer now: stages on different models. Part 2b needs agent tooling and stages that do not exist yet, and its own measurements on a generator.
2. **Which secondary services part 2a supports.**
   - **Options:**
     - (a) Only the primary's engine: more models on the same engine. Ollama loads several models itself; vLLM runs one process per model.
     - (b) (a), plus Ollama as a secondary in a vLLM pod. Ollama's Linux release is downloaded at start, checked by SHA-256, and its Go modules are dated through `proxy.golang.org`: the first engine installed by package, with no Python.
     - (c) (b), plus vLLM as a secondary in an Ollama pod. It needs Python in Ollama's image, which is part 2b's.
   - **Recommendation:** (b), with (b)'s own step (step 7) last, so it can be dropped without touching the rest. It proves decision 6 on a real secondary engine before part 2b depends on it.
3. **How the settings declare a pod's services.** This changes a public interface.
   - **Options:**
     - (a) A profile key, `pod: <name>`. Profiles with the same `pod` share one pod. They must agree on provider, `gpu` and `hosts`, or the run stops with an error naming them. The first profile of the group, in the list's order, is the primary. Profiles without the key behave as today.
     - (b) A top-level `pods:` list of manifests, each naming its profiles.
     - (c) No key: Codeman groups profiles with the same provider, GPU and hosts whenever the fit estimate says they coexist.
   - **Recommendation:** (a). It is additive and local to the profiles it groups, and the profile list already orders preference. (b) repeats the profile names in a second place. (c) changes how existing settings share pods, and their cost, without anyone asking.
4. **How the pod check measures** what only a GPU can tell ([the list](2026-10-30-investigate-multi-service-pods.md#what-only-a-gpu-can-tell)).
   - **Options:**
     - (a) A `measure` check. Its pod's bootstrap downloads and checks a measurement program, `e2e/live/measure.ts`, the way it does the gateway, and runs it in place of the gateway. The program serves its results as JSON behind the run's admin token. It takes two pods per dispatch: Ollama's image with two models, and vLLM's with two processes.
     - (b) Measurement routes in the production gateway.
   - **Recommendation:** (a). The production gateway gains no routes that only a test needs. The output follows the pod check's allowlist ([secrets](2026-11-04-run-e2e-on-github-runners.md#secrets-and-what-a-public-repository-shows)).
   - **Cost:**
     - About 25 minutes for the vLLM pod and 15 for the Ollama pod, on a GPU of 16 to 24 GB: $0.20 to $0.40 per dispatch, under the $1 cap.
     - Expect one dispatch on Runpod and one on Salad, plus one retry each.
     - Salad's 32 GB of RAM bounds sleep level 1, which keeps the weights in host memory.
5. **How vLLM swaps.** Answered after step 3, from the measurements; asked now so the trade-off is known.
   - **Options:**
     - (a) **Sleep mode.** Level 1 for a model that comes back, level 2 when host memory is short. Its routes stay on the loopback.
     - (b) **Stop and start** the process. There is no dev mode, but every swap is a cold start.
   - **Recommendation:** (a) if level 1's wake is well under a cold start and host memory holds the weights; (b) otherwise.
6. **Where each run's occupancy is kept** (decision 5 of the investigation).
   - **Options:**
     - (a) In the run's ledger entry, per service, beside its share: an additive field.
     - (b) Only in the run's log and the gateway's status.
   - **Recommendation:** (a). A later decision on splitting cost by occupancy needs data from many runs, and logs are kept for a day.

## Steps

Steps start once decisions 1 to 4 and 6 are answered. Decision 5 is answered at step 3. Commits are made on `features/multi-service-supervisor`; the e2e suite and every dispatch run only when the maintainer decides.

1. **Save the sources** in `docs/web/`:
   - vLLM 0.32.0's sleep mode and its dev-mode routes;
   - Ollama 0.40.10's scheduling of several models (`OLLAMA_MAX_LOADED_MODELS`, `keep_alive`, `/api/ps`);
   - `nvidia-smi --query-compute-apps`;
   - Ollama's Linux release assets and checksums;
   - for decision 2 (b), the Go module proxy's `.info` and `go.mod` routes.

   Done when the web documentation's tests pass.
2. **Measure** (decision 4): the `measure` check, and its program. It measures:
   - vLLM's wake times at levels 1 and 2, and the host memory level 1 takes;
   - NVML's memory per process beside Ollama's `size_vram`, and whether the container's PIDs make it readable at all;
   - whether a CUDA context frees all its memory when its process exits;
   - load and swap times from disk and from the page cache;
   - the K/V cache two vLLM processes get when they coexist.

   Done when unit tests cover the program's output allowlist and cleanup with a fake `fetch`, and one dispatch on Runpod and one on Salad are recorded here, under the cap.
3. **Read the measurements.** Answer decision 5, and set the budget's margins and the swap mode's limits from them. If they contradict a decision, update this plan and ask for review again. Done when the measurements and decision 5's answer are recorded here.
4. **Settings** (decision 3): the `pod` key, its checks and errors, and the manifest derived from the group's profiles, the cache of fits' key per service included. Done when unit tests cover each error and the manifest of a group.
5. **The manifest's fit** in `open-key`, extending the [estimate](2026-11-23-estimate-the-fit-before-creating-a-pod.md#the-estimate). Services coexist when the primary at its floor context and each secondary's peak fit together. They swap when each fits alone. Otherwise the run is refused before any pod is created. Done when unit tests cover all three outcomes, and a model that cannot be estimated, which starts as today.
6. **The registry:**
   - the pod's document records its manifest;
   - a task joins a pod whose manifest contains its services;
   - capacity follows the [table above](#what-changes);
   - a swapping pod takes one task;
   - pods without a manifest match only exactly, as today.

   Done when `src/inference/registry.test.ts` and `src/inference/selfhosted.test.ts` cover a superset join, a full pod, a swapping pod and an old pod, and the [data layout](../backend/data-layout.md#pod-registry) says so.
7. **Ollama as a secondary engine** (decision 2 (b)). `open-key` resolves Ollama's Linux release by URL and SHA-256 and applies the policy, with the minimum age over its Go modules. The pod's environment carries the URL and digest, and the supervisor downloads, checks and starts it. Done when the release policy's tests cover the Go modules' ages with fixtures, and a tampered download is refused in `src/gateway/` tests.
8. **The supervisor** in `src/gateway/`:
   - **Adapters:** Ollama with several models, and vLLM one process per model, swapping by decision 5.
   - **Routing** of requests by model.
   - **Loading:** a service loads on its first request. Loads that fit together run at once.
   - **Unloading and eviction:** a secondary unloads after it idles, never the primary. Eviction stays within the budget, and never takes a service with a request in flight.
   - **Holding:** a stream held through a swap gets SSE comments.
   - **Isolation:** one service's failure leaves the others serving.
   - **Occupancy:** busy seconds, waiting seconds and GB-seconds, per run and per service.

   Done when `src/gateway/` tests cover each behavior.
9. **Occupancy recorded** (decision 6): `close` and `release-pod` write each run's occupancy per service, and the [split](../inference/pods.md#splitting) stays even. Done when tests show both.
10. **The e2e suite,** on CPU:
    - an Ollama pod whose two models coexist;
    - a pod that swaps, and takes one task;
    - a task whose stages use two services of one pod;
    - a second task that joins by superset.

    Done when the scenarios pass, when the maintainer runs them.
11. **A real pod with two services:** a `services` check in the pod check, coexisting and then swapping, under the cap. Done when a dispatch passes and is recorded here.
12. **The docs:**
    - [pods](../inference/pods.md), [pod engines](../settings/pod-engines.md), [profiles](../settings/profiles.md), [Ollama](../settings/ollama.md) and [vLLM](../settings/vllm.md);
    - the [release policy](../security/release-policy.md), the [data layout](../backend/data-layout.md), [upgrading](../installation/upgrading.md), and the [suite's page](../development/e2e/suite.md);
    - the [glossary](../glossary.md)'s service, manifest and supervisor.

    Done when the docs tests pass.
13. **Checks and handover.** `npm run check` passes, and the live test's list is written here: a task whose stages use two models of one pod, on Runpod and on Salad. Done when both are.

## Out of scope

- Part 2b:
  - Python secondary engines: `python-build-standalone`, wheel sets, the interpreter's `pip`, and the whole-tree check over them;
  - image and video generators, the tool the agent calls to generate, and the stages that use them.
- Scanning OS packages at run time, for images people choose ([decision 4 of part 1](2026-10-30-start-pods-from-official-engine-images.md#decisions)).
- Settings that choose an engine's version.
- Splitting cost by occupancy: this plan only records it.
- Several GPUs per pod, and Serverless endpoints.
