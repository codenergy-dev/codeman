---
status: in progress
created_at: 2026-10-30T11:20:00-03:00
updated_at: 2026-10-30T11:20:00-03:00
commit: 7f54c3c
---

# Investigate multi-service pods

## Goal

Find out, by experiment on a local Docker without a GPU, whether one pod can serve several [services](#terms) (an engine and a model each), loaded into memory only when a run asks for them, with engines that the pod downloads when it starts under a security policy. The results answer the [open decisions](#open-decisions) and shape the implementation plan that follows. What only a GPU can tell is left to a live test on Runpod or Salad.

## Context

### Why

Image and video stages need a generation model beside the agent's LLM, often on another engine. Two pods per task double the GPU bill, so the intent is one pod that serves both, and gives GPU memory to a generator only while a run uses it. People run their models on many engines, so Codeman should not tie itself to one engine that does everything (such as vLLM-Omni).

### What a pod is today

A pod serves one engine and one model, fixed when it is created:

| Today | Where |
| --- | --- |
| The engine and the model come from the pod's environment and never change | `podSettings` in `src/gateway/pod.ts` |
| One pod image per engine, built by Codeman; the gateway refuses another engine | `docker/pod/Dockerfile`, `src/gateway/main.ts`, `src/inference/images.ts` |
| The fit gives the engine the whole GPU | `src/gateway/fit.ts`, `src/gateway/vllm.ts` |
| A pod is shared only by tasks whose pod settings hash the same | `podSettingsKey` in `src/inference/selfhosted.ts` |
| Capacity is that one engine's parallel requests | [Pods](../inference/pods.md#capacity) |
| The pod is healthy once its model serves, within 25 minutes | [Pods](../inference/pods.md#timers) |

### Terms

| Term | Meaning here |
| --- | --- |
| Service | One engine serving one model with its settings, inside a pod |
| Manifest | The services a pod may serve, decided when it is created |
| Supervisor | The process in the pod, grown from the gateway, that starts, loads, sleeps and stops services and routes requests to them |
| Primary service | The service the agent's LLM runs on; the pod is healthy once it serves |
| Secondary service | Any other service, such as an image generator; it loads on demand |
| Resolution | The exact artifacts of a manifest (URLs and SHA-256 digests), with what the policy checks found |

### Three moments of a service

| Moment | Where | What happens |
| --- | --- | --- |
| Creation | `open-key` | The manifest is resolved and checked; it decides the image and the disk |
| Start | The pod | Engines and weights are downloaded and verified: the primary first, the others in the background |
| Request | The pod | A secondary service is loaded into memory when a run asks for it, and unloaded when idle or when another needs the memory |

The rule is: download early, load late.

## Decisions

Answered by the maintainer on 2026-10-30, in the conversation that led to this plan.

1. **The supervisor lives in the pod**, as the gateway's evolution. The registry keeps the manifest and the state the pod reports. Codeman has no long-lived process outside pods.
2. **Coexist or swap, chosen by the fit.** When the primary service at its floor context and a secondary service's peak fit together, both stay loaded as needed. When they do not, they swap: the primary sleeps while the generator runs, and such a pod takes one task, since its orchestrator waits on the generation anyway.
3. **Pods match by superset.** A task needs a set of services and joins a pod whose manifest contains them, so a task's kept pod from the image stage serves its code stage.
4. **No single engine for everything.** Each engine family gets an adapter in the supervisor; vLLM-Omni is one candidate among others, not the base.
5. **Cost:** each second of the pod is still split evenly among its runs; the supervisor measures each run's occupancy of the GPU, for a later decision.
6. **Resolve outside, verify inside.** `open-key` resolves the manifest and applies the policy (minimum age, advisories, provenance); the pod gets only exact URLs and digests, verifies each download and refuses any mismatch.
7. **The primary engine is the pod's image**: an official image pinned by digest, whose entry command downloads and verifies Codeman's gateway, then starts it. Only secondary engines are downloaded at start.
8. **Settings are out of scope here.** How this is set in `CODEMAN_SETTINGS` comes later.
9. **Experiments run on this machine's Docker** (amd64, no GPU), each in its own directory under `experiments/multi-service-pods/` on this branch. The maintainer validates on a GPU later, with Codeman on a test repository.

### Open decisions

To be answered by the maintainer from the [findings](#findings):

- **A. Minimum age.** How many days a release must have been published, for the whole dependency tree, and how a newer release that fixes a known advisory passes.
- **B. Advisories.** Which severities block a resolution, and where an exception is accepted (only in the settings files, as `hosts`).
- **C. Provenance.** Required when the publisher offers it, or only recorded.
- **D. Operating system packages.** Whether to scan an image's OS packages (Trivy, Grype), a new dependency, or check only the engine and its language dependencies.
- **E. Python for secondary engines.** Where a Python engine gets its interpreter when the primary image has none.
- **F. The experiments directory.** Kept as reference, or removed before the branch merges.

## Steps

Each experiment records the third-party pages it relies on in `docs/web/`, following [Fetch Markdown](../web/tools/fetch-markdown.md) and the tools in `docs/web/tools/`. Every image and artifact is pinned by digest or SHA-256. Experiments do not add dependencies to Codeman's `package.json`; a third-party tool used only to experiment runs in a container pinned by digest, and its audit goes in the findings.

1. **Write this plan.** Done when it is committed on `features/multi-service-pods`.
2. **E1: inject the gateway into official images** (`experiments/multi-service-pods/bootstrap/`). For `ollama/ollama`, `vllm/vllm-openai`, `vllm/vllm-openai-cpu`, `lmsysorg/sglang` and one diffusion-capable image: whether each has glibc, a downloader (`curl`, `wget`, Python) and a shell; a bootstrap that downloads Node and the gateway from a local HTTP server, verifies their SHA-256, refuses a tampered file and starts the gateway in front of the image's engine; how Runpod's and Salad's create APIs override the entry command. Done when a table gives each image's result and the bootstrap passes on the CPU-capable images.
3. **E2: a supervisor of several services** (`experiments/multi-service-pods/supervisor/`). In one container, a prototype supervisor on Node's built-ins serves at least two services on two engines, such as Ollama with a small LLM and a small diffusion model behind a Python server. It loads a secondary service on its first request, unloads it when idle, evicts under a memory budget (process memory standing in for GPU memory), holds requests to a service that is swapping with SSE comments, and serves generation as submit and poll. Done when a script shows each behavior, with load and unload times on CPU, and the findings list what only a GPU can tell (sleep mode, NVML, peaks of quantized models).
4. **E3: resolve outside, with the policy** (`experiments/multi-service-pods/resolver/`). A prototype on `fetch` that resolves Ollama from a GitHub release, a Python engine as a fully pinned set of wheels for linux x86_64, and an OCI image from its registry. For each: every artifact's digest, its age, the advisories that OSV.dev and GitHub report, and the provenance its publisher offers (commit, signed tags or commits, release immutability, GitHub or PyPI attestations, image signatures). Done when it writes a resolution per engine and a report of how often a 7, 14 or 30 day minimum age holds a version back.
5. **E4: verify inside the pod** (in E2's directory). An in-pod downloader that hashes while it streams and refuses a mismatch; a wheel set installed with `--no-deps --only-binary :all: --require-hashes` into a virtual environment; what to do when the primary image has no Python. Done when a tampered artifact is refused and the secondary engine of E2 is installed from E3's resolution, with sizes and times.
6. **E5: scan OS packages** (in E1's directory). Trivy and Grype, each in a container pinned by digest, against the vLLM and Ollama images: their time, the size of their databases, the findings by severity, and whether a GitHub-hosted runner can run them within `open-key`. Done when the findings compare both.
7. **Record the findings** below, with a recommendation for each open decision, and ask the maintainer for the answers. Done when every open decision has a recommendation backed by an experiment.

## Findings

To be written by the steps.

## Out of scope

- How any of this is set in `CODEMAN_SETTINGS`, profiles or subagents.
- Image and video stages, and the tool the agent calls to generate.
- Changing Codeman's production code, its pod images or its dependencies.
- Measurements that need a GPU: they belong to the live test after this plan.
- Merging this branch.
