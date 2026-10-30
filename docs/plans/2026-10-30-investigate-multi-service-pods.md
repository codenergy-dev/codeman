---
status: in progress
created_at: 2026-10-30T11:20:00-03:00
updated_at: 2026-10-30T15:40:00-03:00
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
- **G. Images without a downloader.** How the bootstrap gets its first file in an image with no `curl`, `wget` or Python, such as Ollama's. Raised by E1.

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

Steps 1 to 6 are done, committed as `9f289c9`, `4cc2821`, `9c822d8` and `796eb82`. Each experiment's scripts say in their header how to run them again. Their downloads and generated output are git-ignored (`.work/`, `resolver/out/`). Timings are from a shared 4-core laptop CPU that was swapping, so they show behaviors, not sizes.

### E1: the gateway injected into official images

| Image | OS, glibc | Downloader | Node 24 runs | Result |
| --- | --- | --- | --- | --- |
| `ollama/ollama:0.35.1` | Ubuntu 24.04, 2.39 | **None**: no `curl`, `wget` or Python; only `openssl` | Yes | Gateway up, chat answered, through `openssl s_client` |
| `vllm/vllm-openai-cpu:v0.31.0` | Ubuntu 22.04, 2.35 | `curl`, `wget`, Python | Yes | Gateway up; the engine ran out of the 4 GB memory cap at the gateway's tool-call probe |
| `vllm/vllm-openai:v0.31.0` | Ubuntu 24.04, 2.39 | `curl`, Python | Yes | Gateway up; the engine stops without a GPU, as expected |
| `vllm/vllm-omni:v0.30.0` (no v0.31.0 tag) | Ubuntu 24.04, 2.39 | `curl`, Python | Yes | As `vllm-openai`; the image has no entrypoint |
| `lmsysorg/sglang:v0.5.22` | Ubuntu 24.04, 2.39 | `curl`, `wget`, Python (per its history) | Not run | Inspected through the registry only: 15.6 GB |

- Every image runs as root and has `sh` and glibc. Node's official binary runs in all four that were pulled.
- The bootstrap refused a tampered gateway, a tampered tarball, a 404, and a malformed or missing digest, each before anything ran.
- It costs 2 to 3.5 s from a local release: mostly unpacking Node, which drops when only `bin/node` is extracted.
- **Entry command.**
  - Runpod's REST API takes `entrypoint` and `cmd` in exec form, within a 100 KiB request ([Runpod REST API](../web/runpod/runpod-rest-api.md#the-containers-command)).
  - Salad's `container.command` takes at most 100 items of at most 1,000 characters, each on one line ([specifying a command](../web/salad/specifying-a-command.md)).
  - Neither expands variables, so the bootstrap goes in as `sh -c` with one script line per item: 73 items, the longest 111 characters (`bootstrap/command.ts`).
- **Contradicts the plan.**
  - An image without a downloader exists: Ollama's. Its `openssl` fallback speaks HTTP/1.0 and follows no redirect, and GitHub's release downloads redirect.
  - The gateway's `CODEMAN_IMAGE_ENGINE` check proves nothing once the environment, not the image, sets it.
  - Its tool-call probe asks for `max_tokens: 4096`.

### E2: a supervisor of several services

All nine behaviors are proved by `supervisor/prove.ts`, in one container from the Ollama image, with Ollama serving `qwen2.5:0.5b` and `smollm2:135m`, and a Python `diffusers` generator:

| Behavior | Result on CPU |
| --- | --- |
| Adapters per engine family | Ollama loads with `keep_alive: -1`, unloads with `0`, and the adapter waits until `/api/ps` and its `llama-server` agree. Python starts its process, then waits for `/health` |
| Lazy loading | The generator's first job took 24.1 s, its load included; the second took 0.27 s |
| Idle unloading | After 3.4 s with N = 3 s; the primary is never unloaded for being idle |
| Budget and eviction | Loading the generator evicted the idle subagent. A subagent with a stream in flight was not evicted: the generator waited for it to end |
| Holding during a swap | A cold stream got an SSE comment every 250 ms, then its answer |
| Swap mode | Primary unloaded in 87 ms, generator loaded in 10.3 s and ran, then the primary reloaded in 11.5 s: 42.9 s in all, with a chat held through it |
| Asynchronous generation | Submit answers `202` with an ID; polling gives the status; the image is served from a file, never inlined; another run gets `404` |
| Failure of one service | A generator that cannot load is marked failed; the primary keeps answering, and new submits get `503` |
| Occupancy | Per run and per service: busy and waiting seconds, GB-seconds and requests |

- **Contradicts the plan.**
  - A Python generator's load is dominated by starting the process and importing torch, not by its weights. "Download early, load late" needs a third state: the process alive with its weights unloaded.
  - The prototype serialized loads under one lock, so a subagent's request waited 18.9 s behind the generator's load. Loads that fit together should not wait for each other.

### E3: resolving outside, with the policy

| Check | GitHub release (Ollama 0.35.1) | Wheels (PyPI) | OCI image (`vllm/vllm-openai:v0.31.0`) |
| --- | --- | --- | --- |
| Digest | Each asset's `digest`, matching `sha256sum.txt` | Each file's | Index and platform manifests |
| Date | `published_at` | Each file's `upload_time` | The config's `created`, set by its builder |
| Dates of the whole tree | Go modules only, not its C and CUDA libraries | Every wheel | No: no SBOM |
| Advisories | OSV: Ollama's own 9 have no fix | OSV, in one batch | OSV for `vllm` only: 10 (2 high), all fixed in 0.32.0 |
| Provenance | Mutable release, lightweight tag, no attestation | PEP 740 for 22 of 43 diffusers wheels (23% of bytes) and 87 of 211 SGLang wheels (10%); none for torch or NVIDIA's | No signature, no attestation; the revision label names an unsigned commit |

Wheel sets for linux x86_64, Python 3.12, wheels only (every package had one):

| | `diffusers` on CPU | SGLang 0.5.17 |
| --- | --- | --- |
| Packages, size | 43, 0.26 GB | 211, 4.04 GB |
| Advisories (high and critical) at a 7, 14 and 30 day minimum age | 0 (0), 60 (30), 57 (30) | 5 (0), 64 (30), 69 (33) |
| After the security fix bypass, high and critical blocked | 1 low | 5 moderate or low, held by SGLang's exact pins |

- **A longer minimum age alone ships more known vulnerabilities**, since the fixes are recent. At 14 days, every advisory of the `diffusers` set had a fix, and every fix was younger than 14 days.
- **The bypass that works:**
  1. Lock at an absolute date and record it.
  2. For each blocking advisory, admit only the earliest release that fixes it, as a floor and as a per-package date.
  3. Lock again with every first version as a floor. Without that floor, uv backtracked SGLang from 0.5.17 to 0.5.2, with 3 unfixed critical advisories.
  4. A lock that cannot be satisfied blocks.
- OSV's data is enough for it. GHSA records carry severities and fixed versions, and Go records carry none.
- **Other findings.**
  - The PyTorch index gives no size, no yank and no provenance, and its dates are copy dates.
  - uv's newest release older than 14 days had a critical advisory; the bypass took its fix, and the locks were identical.
  - Node 24.21.0's bundled CA store trusts a root named in that advisory. This is not yet checked against Node's own advisories, and it touches `open-key` in production.

### E4: verifying inside the pod

- **Python.** The Ollama image has none. A standalone CPython 3.12 from `python-build-standalone` (34 MB, an immutable release with checksums and GitHub attestations) served the generator.
- **Downloader.** The in-pod downloader hashes while it streams. It refused a whole set over one tampered file, with nothing written, and stopped a body longer than announced.
- **Install.** E3's 14-day set, and its set with the bypass, both installed with `pip install --no-index --no-deps --only-binary :all: --require-hashes`:
  - 264 MB of wheels, 196 MB of them torch;
  - 82 s to install;
  - 1.2 GB on disk;
  - `pip check` clean.
- **Not covered.** The interpreter's bundled `pip` (25.0.1) is outside the policy.

### E5: scanning OS packages

| | Trivy 0.76.0 | Grype 0.120.1 |
| --- | --- | --- |
| Database | 137 MB, 1.6 GB unpacked, plus 1 GB for Java | 197 MB, 3.3 GB unpacked; refuses to scan with one over 5 days old |
| Ollama image | 28 min. OS: 47, none high. Go binary: 97 (50 high), 96 with a fix | 9.5 min. OS: 104, none high. Go: 51 (4 critical, 33 high), all with a fix |
| vLLM image | 41 min. OS: 5,178, but 4,227 are `linux-libc-dev` (kernel headers); without them 951, with 15 high and no critical. Python: 91 (9 critical), all with a fix | Killed for memory twice (3 and 4 GB), after 24 min and 22 GB of temporary files |
| Own advisories | A supply-chain compromise in 2026-03 (0.69.4 to 0.69.6; images pinned by digest unaffected); a path traversal through a crafted database, fixed in 0.71.1 | Registry credentials in its JSON output, fixed in 0.104.1 |

- Neither fits within `open-key` on a GitHub-hosted runner. A 9 GB image, 1.6 to 3.3 GB of database, and Grype's memory and temporary disk are too much.
- The high findings sampled mostly do not apply to an engine on loopback (HTTP/2 over TLS, an SSH library), or only with a feature turned on (LMCache).

### What only a GPU can tell

For the live test on Runpod or Salad:
- vLLM's sleep mode: wake times at levels 1 and 2, and the host memory level 1 needs. It needs `VLLM_SERVER_DEV_MODE=1`, whose routes must stay behind the gateway ([sleep mode](../web/vllm/sleep-mode.md)).
- NVML's memory per process, compared with Ollama's `size_vram`.
- Whether a CUDA context frees all its memory when its process exits.
- The peak of a quantized or diffusion model during generation, VAE decoding included.
- How to size the KV cache next to a resident generator.
- Load and swap times from disk and from the page cache.

### Recommendations

| Decision | Recommendation | Backed by |
| --- | --- | --- |
| A. Minimum age | 7 days for the whole tree, with the security fix bypass always on | E3: 0 to 5 advisories at 7 days, 57 to 69 at 14 or 30 |
| B. Advisories | Block high and critical. One without a fix passes only through an exception in the settings files, with its reason. Moderate and low are warnings | E3. As it stands, Ollama 0.35.1 needs exceptions for its own advisories, which have no fix, and vLLM 0.31.0 is blocked while 0.32.0 passes |
| C. Provenance | Record it; do not require it. Block only when a package that offered provenance in its earlier releases stops offering it | E3: none for Ollama, vLLM's image or torch |
| D. OS packages | Scan with Trivy, pinned by digest and subject to the same minimum age. Once per image digest, outside `open-key`, cached in the backend. Block high and critical with a fix; skip `linux-libc-dev` | E5 |
| E. Python for secondary engines | `python-build-standalone`, resolved and checked by `open-key` like any artifact, with `pip` pinned as a wheel of the resolution | E4 |
| F. The experiments directory | Keep it on this branch as reference until the implementation replaces it; remove it before the branch merges | – |
| G. Images without a downloader (new) | Bootstrap in two stages. The shell fetches only Node, from `nodejs.org`, through whatever the image has, `openssl` included, and checks its SHA-256. Node then fetches and checks everything else, redirects included. To check: that `nodejs.org` answers without a redirect | E1 |

## Out of scope

- How any of this is set in `CODEMAN_SETTINGS`, profiles or subagents.
- Image and video stages, and the tool the agent calls to generate.
- Changing Codeman's production code, its pod images or its dependencies.
- Measurements that need a GPU: they belong to the live test after this plan.
- Merging this branch.
