---
status: in progress
created_at: 2026-11-04T14:47:33-03:00
updated_at: 2026-11-06T18:15:00-03:00
commit: e1c1411
---

# Run the e2e suite on GitHub's runners, and check pods on real GPUs

## Goal

The maintainer starts two checks by hand from Codeman's public repository. The e2e suite runs on GitHub's free runners, so it no longer takes over a developer's machine. A second, short check starts a real pod on a real GPU, which shows what the fakes and the CPU hide before a live test.

## Context

- The suite runs only on a developer's machine ([decision 6 of the e2e plan](2026-10-20-end-to-end-test-suite.md), which left CI to its own plan). A full run took 134 minutes on 8 CPUs, and most of a 10 GB Docker VM.
- Its pods run the real engines on the CPU with a tiny model. [The suite's page](../development/e2e/suite.md#what-it-does-not-cover) lists vLLM on a GPU, the production vLLM image and the proxy's 100-second cut as not covered.
- [Part 2](2026-10-30-start-pods-from-official-engine-images.md#handover) needs [measurements only a GPU gives](2026-10-30-investigate-multi-service-pods.md#what-only-a-gpu-can-tell).

### Why not GitHub's GPU runner

An earlier version of this plan proposed it. It costs far more per hour, and it tests less:

| | Per hour | 30 minutes |
| --- | --- | --- |
| GitHub, Tesla T4, 16 GB | $3.12 | $1.56 |
| Runpod Secure Cloud, RTX A5000, 24 GB | $0.27 | $0.135 |
| Salad High priority, RTX 5060 Ti, 16 GB | $0.155 | $0.08 |

Prices were read on 2026-11-05 from [GitHub](https://docs.github.com/en/billing/reference/actions-runner-pricing), [Runpod](https://www.runpod.io/pricing) and [Salad](https://salad.com/pricing/), and may change. The real API, proxy and downloads are reachable only on a provider.

### Why the suite does not run in a pod

The suite needs Docker Compose, a container per job, and `SYS_ADMIN` for the agent's jail.
- Runpod: ["you cannot spin up your own Docker instance or use Docker Compose on Pods"](https://docs.runpod.io/pods/overview).
- Salad: ["Containers can't run in privileged mode"](../web/salad/salad-container-engine-overview-how-saladcloud-works.md), and a node can go offline, its replacement starting with an empty disk.

So the suite runs on a runner, and a GPU check runs a pod from a runner.

## Decisions

Answered by the maintainer on 2026-11-05:

1. **Two checks,** the suite on `ubuntu-latest` and a real pod for the GPU, instead of GitHub's GPU runner.
2. **Both in Codeman's public repository.** A second, private repository is not used. The fork risk is handled in [secrets](#secrets-and-what-a-public-repository-shows).
3. **Started by hand only,** with `workflow_dispatch`. Never on a push, pull request or schedule.
4. **The care with secrets is the same as Codeman's own on any repository:** no secret reaches a log, an artifact or a step that does not need it. The organization keeps logs and artifacts for one day, to limit the damage in the worst case.
5. **AGENTS.md gains a rule, if this works:** running the e2e suite is first asked of the person responsible, who decides whether and where it runs (step 7).

Also answered on 2026-11-05:

6. **The Runpod account already in use holds the key,** not a separate one. A key that manages pods needs **All** permissions, [expires never and has no spending limit](../web/runpod/manage-credentials.md), so a leak reaches every pod of the account. The maintainer keeps the prepaid balance low, watches the spending, and revokes the key if needed.
7. **The workflow reaches `main` on a branch from `fixes/node-24-22-1`.** `workflow_dispatch` runs only for a workflow on the default branch. The maintainer pushes and merges it, and the first dispatch gives the Node fix its e2e run, on `main`. Exceptionally, the fix reaches `main` before that run: the maintainer is Codeman's only real user, and the project is still experimental.
8. **The workflow downloads `act` 0.2.89's Linux release** from GitHub, checked by SHA-256. The audit covered Homebrew's bottle of the same version; two scenarios need it, and the job has no secret.

Answered on 2026-11-06, after the first dispatches of the pod check:

9. **The pod check is a job of `e2e.yml`,** chosen by a `check` input, rather than a workflow of its own: `e2e.yml` is already on `main`, so it can be dispatched on a branch, and only its `pod` job names the `E2E` environment.
10. **The gateway reports its Node.js version and its own SHA-256 in `/admin/status`,** so the pod check proves what the bootstrap verified, instead of inferring it.
11. **The pod check picks its GPU itself,** cheapest first, under the $1 cap for the whole run, from a list of GPU types per check that fit its needs: enough memory for its model and engine, not much more. An explicit GPU type stays possible.
12. **It may use Runpod's Community Cloud,** through a workflow input on by default. A pod there receives Runpod's pod-scoped key, not the account's, and the check's model is public. The pod check on Salad (step 5) runs on community hosts anyway, since Salad's secure hosts need a contract.

## Secrets and what a public repository shows

What each check needs to see, and nothing else:

| Check | Secret | Variable |
| --- | --- | --- |
| The suite on `ubuntu-latest` | None: every key is a fake's | None |
| Real pod, on Runpod | `CODEMAN_RUNPOD_API_KEY`, in the `E2E` environment | None: the GPU type and model are the workflow's inputs |
| Real pod, on Salad, later | `CODEMAN_SALAD_API_KEY`, in `E2E` | `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT`, in `E2E` |

The names are those of [the templates](../../templates/codeman-task.yml). The `E2E` environment admits only the branches `main`, `features/*` and `fixes/*`. Other keys the check uses, such as the encryption secret and the gateway's tokens, are made for the run and registered as masks.

> [!WARNING]
> A public repository's logs can be read by anyone while they are kept. GitHub masks a secret's exact value only, not what is derived from it, and a gateway's [admin token](../../src/inference/selfhosted.ts) is derived from the account key.

Rules for the workflow, each checked by a test or by reading the file in step 2:

- **Triggers:** `workflow_dispatch` only; never `pull_request_target`. A fork's pull request gets no secret (to confirm from GitHub's page, in step 1).
- **Permissions:** `permissions: contents: read`, and `persist-credentials: false` on checkout.
- **The secret's reach:** the environment on the one job that needs it, and the secret in the `env` of the one step that uses it. The suite's job names no environment, so it cannot read it.
- **Inputs:** read through `env`, never interpolated in a script. GPU type and model are validated against a pattern.
- **Output of the pod check:** prints only values on an allowlist (times, memory, status, GPU type), never a pod's URL, ID, environment or a response's headers; no `set -x`; no artifact; no cache.
- **Artifacts of the suite:** only its job uploads, `retention-days: 1`. It holds no real key: the job has no secret, and its keys are the fakes' constants and the session's random tokens.
- **Actions:** pinned by full commit SHA, as `ci.yml` is.
- **A forgotten pod:** a last step, `if: always()`, terminates the run's pods, and the pod's own `CODEMAN_START_BY` and the job's `timeout-minutes` bound the rest.

## Steps

1. **Save the sources.** GitHub's pages on larger runners, runner pricing, billing, `workflow_dispatch`, environments, and secrets on forks' pull requests, under `docs/web/github/`; Runpod's on pods and pricing; Salad's on pricing. Done when the web documentation's tests pass, and these pages confirm or correct this plan.
2. **The suite on `ubuntu-latest`.** `.github/workflows/e2e.yml`, by the rules above, with an input of scenario selectors:
   - one job per group, by profile: scenarios with neither `ollama` nor `vllm`, `ollama`, `vllm`. It lowers the time and each job's disk: both profiles take about 17 GB of images, and a standard runner [documents 14 GB](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Each job's models and images download again, since no cache is kept.
   - the suite's report uploaded on failure.

   Done when the maintainer's dispatch passes every scenario, and this plan records each group's time and peak disk.

   **What may not work, to measure:** a vLLM request's first answer takes about 6 minutes on 8 CPUs, and the probe waits for 10; a runner's 4 vCPUs may exceed it. Docker Hub may limit anonymous pulls. If the `vllm` group does not fit, ask before using a larger runner (`linux_8_core`, $0.022 per minute): a cost this plan does not include.
3. **A pod check, from the sources.** A script, `e2e/live/pod.ts` for instance, run with Node, not the e2e build, so no redirect applies. It builds `PodInference` with the real `Runpod`, and a store local to the run. It starts a pod on Ollama, then one on vLLM, each from the catalog's official image through the bootstrap, with the real release policy and a tiny public model, and:
   - checks that the bootstrap verified Node.js and the gateway, from the real `nodejs.org` and `raw.githubusercontent.com` at the run's commit;
   - checks `/health`, and one chat answer through Runpod's proxy;
   - checks the fit against the real GPU memory;
   - prints the times, and terminates the pod.

   Done when unit tests cover the script's allowlisted output and its cleanup, with a fake `fetch`, and a dispatch passes on Runpod for less than $1, recorded here.
4. **Failures on a real pod.** A model that does not fit fails with the fit's message, and a release that is blocked starts no pod. Done when both are in the dispatch.
5. **Salad.** The same check, with the group's replicas and the Container Gateway. A node's interruption fails the run as "infrastructure", not as a Codeman failure. Done when a dispatch passes. Asks first whether the user's key, which reaches all of their organizations, is acceptable here.
6. **Docs.** [The suite's page](../development/e2e/suite.md) says how to start each check and what each costs, and [dependencies](../development/dependencies.md) records the workflow's actions. Done when the docs tests pass.
7. **The rule in AGENTS.md,** once steps 2 and 3 work. Its sections also reach the repositories Codeman runs on, so it must hold for any of them. A bullet under "Ask before critical decisions":

   > Running end-to-end tests, or any other slow or costly suite: the person responsible decides whether it runs, and where.

   Done when the maintainer has approved the text.

Part 2's measurements (sleep mode, NVML, a CUDA context's release, load and swap times) can then use the pod check. Its plan decides that.

## Out of scope

- Running either check on every push, pull request or schedule.
- GitHub's GPU runner, and VMs with a GPU from other providers.
- Scripted scenarios on a GPU: they test Codeman's logic, which a GPU does not change.
- Replacing the live test: the whole path with a real agent, a real repository and real GitHub App stays with the maintainer.
- Models that need more memory than the chosen GPU has.

## Progress

As of 2026-11-05, steps 1 and 2's workflow and docs are on the branch `features/e2e-on-github-actions`, in the worktree `../codeman-e2e-actions`, from `fixes/node-24-22-1`. Not pushed, and not yet run. This plan stays on `features/multi-service-pods`, since its links reach files only that branch has.

- `351aa5f`: the workflow's sources.
- `f6aa0f1`: `--profile=none|ollama|vllm` selects a group from each scenario's `profiles:`.
- `4d89540`: `.github/workflows/e2e.yml` and its docs.

On 2026-11-05 the maintainer pushed it and opened its pull request. CI failed in one test, unrelated to the branch: `ubuntu-latest` is moving to Ubuntu 26.04 until 2026-11-19 ([announcement](https://github.com/actions/runner-images/issues/14748)), and its `systemd-udevd` 259 binds an abstract socket that the sandbox test has not reviewed. Codeman's sandbox was reviewed on Ubuntu 24.04 only. The maintainer chose to pin `ubuntu-24.04`, and to leave Ubuntu 26.04 to its own plan, `docs/plans/2026-11-05-review-codeman-on-ubuntu-26-04.md` on that branch:

- `f54a771`: the templates, CI and this workflow on `ubuntu-24.04`, with a test, and the plan for Ubuntu 26.04.
- `e5a52fe`: the upgrade guide's entry names it.

On `ubuntu-24.04`, CI first failed in another sandbox test, `the agent is contained and its changes are collected safely`. It was stopped at its 120-second limit after 163 seconds, and `npm test` took 189 seconds where `main`'s last pass took 29. A re-run of the failed job passed, on image `ubuntu24/20261025.353`, so it is taken as intermittent. A limit reached that late means a synchronous call held the process past 120 seconds. Those calls come after the agent ends: `sealAgentSandbox`, whose `loginctl` calls have no time limit, is the likeliest. If it fails again, a test-only commit times each phase before `src/sandbox.ts` changes.

The maintainer merged it into `main` (`f00d362`) and dispatched it on 2026-11-05. The runner had a 145 GB disk with 86 GB free, not the 14 GB documented, and every image and volume stayed on it: the logs show disk before and after each group, not its peak.

| Group | Scenarios | Result | Job | Disk used, before → after | Docker, after |
| --- | --- | --- | --- | --- | --- |
| `none` | 30 | 30 passed | 53 min 56 s | 59 → 61 GB | 3.7 GB of images, 60 MB of volumes |
| `ollama` | 16 | 16 passed | 23 min 49 s | 59 → 66 GB | 9.4 GB of images, 458 MB of volumes |
| `vllm` | 2 | 2 failed | 18 min 14 s | 59 → 67 GB | 8.8 GB of images, 1.06 GB of volumes |

So the Node fix passed all 46 scenarios on Ollama and without an engine.

Both vLLM scenarios failed for the same reason: vLLM found no snapshot of the model, offline (`LocalEntryNotFoundError`). The gateway runs `vllm serve` with the model's name and no revision, so huggingface_hub reads the commit from `refs/main`. `seed-hf` downloads by commit, and a download by commit writes no ref (`_cache_commit_hash_for_specific_revision` in huggingface_hub 1.33.0's `file_download.py`). Local runs passed because their volume kept the `refs/main` of spike 0.1's download. `fit-vllm-explicit` failed on vLLM's message, and `vllm-two-seats` waited 900 seconds for a gateway that never became ready.

- `608bf60`, on `fixes/e2e-hf-refs-main` from `main`: `seed-hf` writes `refs/main`. Whether the 10-minute probe fits 4 vCPUs is still unmeasured.

The maintainer dispatched the two vLLM scenarios on that branch. No scenario ran: `seed-hf` exited with 1, and `compose up --detach` showed none of its output. The job took 4 min 51 s. The first `vllm` job took about 2 min 15 s besides its scenarios, so the seed ran about 2.5 minutes longer. That matches its five failed downloads with their 150 seconds of pauses, more than a failure of `refs/main` right after a download. So the Hub probably refused or failed the download, which the plan listed as a risk for anonymous downloads. Not confirmed.

- `dcae7e2`: when `compose up` fails, the suite prints the last 50 lines of each service that exited with an error.

A third dispatch on that branch passed both, in a job of 8 min 1 s: `fit-vllm-explicit` in 69.3 s, `vllm-two-seats` in 298.5 s. The seed downloaded the model this time, so the second run's failure is taken as the Hub's, and passing; the diagnostic stays for the next one. A vLLM pod's first answers fit the 10-minute probe on 4 vCPUs, so the `vllm` group needs no larger runner.

So every one of the 48 scenarios has passed on `ubuntu-24.04`, across these dispatches. Peak disk is not measured, only before and after, and the runner's 86 GB free leave room for all three groups. Step 2 is done once `fixes/e2e-hf-refs-main` reaches `main`.

On 2026-11-06:

- `5097df4`, on `fixes/e2e-hf-refs-main`: its own plan, `docs/plans/2026-11-06-seed-the-e2e-vllm-model-with-refs-main.md`, completed, which the maintainer uses as the pull request's description, and the two `huggingface_hub` sources it relies on.
- The maintainer created the environment as `E2E`, not `e2e-live`, for the branches `main`, `features/*` and `fixes/*`, with the secret `CODEMAN_RUNPOD_API_KEY`.
- Step 7: the maintainer approved the rule's text, and asked for it before step 3. `7590efa`, on `main`, adds it to `AGENTS.md`, not yet pushed.

Next: the maintainer merges `fixes/e2e-hf-refs-main` and pushes `main`, then gives the digests of the pod images built from the Node fix, which a commit on `main` pins. Then step 3.

Step 3's script and unit tests, on `features/multi-service-pods`, not yet run on Runpod and with no workflow yet:

- `0586808`: the check's report: allowlisted fields only, and `::add-mask::` for each secret and identifier as soon as the run has it.
- `74e26ce`: `e2e/live/pod.ts`, with step 4 as two more checks, `blocked` and `unfit`; a run costs at most 1 USD at the GPU's listed price for its max minutes.
- `5e88b85`: [the pod check's section](../development/e2e/suite.md#the-pod-check).

Open for the workflow: where it lives, and its `concurrency`, since a run terminates another's pods.

The maintainer approved a direct proof of what the bootstrap checked:

- `ff84219`: a pod's gateway reports `node` (`process.version`) and `gatewaySha256` (its own file, hashed once at its start) in `/admin/status`. `GATEWAY_VERSION` stays 2: the fields are optional, and `open-key` compares the version to tell gateways that serve one run at a time. `dist/` is rebuilt.
- `049f22b`: the pod check requires `NODE_RELEASE`'s version and the gateway's SHA-256 at the run's commit, besides the pod's spec.

The maintainer's first dispatch of the pod check, on `NVIDIA RTX A5000` with `ollama` at `6e4496b`, ended in 4.4 s: `ollama.start result=unavailable`, no pod created, cleanup passed. With one kind of host, the adapter takes any 400 for no room, and Runpod answers 400 to a request that breaks a rule too ([create a pod](../web/runpod/create-a-pod.md#errors)); the bootstrap's pod spec had never been created on Runpod. So the output could not tell them apart.

- `9cad27d`: the start line gives the catalog's availability before each pod, and Runpod's message cleaned of hidden values and URLs; a 400 while the catalog lists room is `fail`, not `unavailable`.

The next dispatch, at `98c0c18`, showed `NVIDIA RTX A5000` with `availability=NONE`: no room, not a bad request. On `NVIDIA GeForce RTX 4090` ($0.89 per hour), `ollama` passed, the first pod started from an official engine image through the bootstrap on a real GPU:

| Phase | Result |
| --- | --- |
| Creation | 3.7 s, with `availability=LOW` in 1 data center |
| Serving | 56.3 s after creation |
| Bootstrap | `node=v24.22.1`, `node_match=true`, `gateway_sha256_match=true`: the pod verified and ran Node.js 24.22.1 and the gateway at the commit |
| `/health` | 200, ready |
| Fit | 0.936 GB, wholly on the GPU's 24 GB, context 32,768, 1 parallel request |
| Chat through Runpod's proxy | 200, answered in 27.4 s, the model's first load |
| Cost | $0.021, 88.9 s in all; cleanup terminated the 1 pod, and the workflow's last step found none |

A dispatch of `vllm,blocked,unfit` on the RTX 4090, at `9021375`, ended in 4.2 s with no pod created:

- `vllm`: the catalog listed room with CUDA 13.0 or newer (`availability=LOW`, 1 data center), then the creation answered 400, "There are no longer any instances available with the requested specifications." The check called it a request problem; it was the room going in between. `4bac7bd` takes Runpod's no-instances message as no room.
- `blocked`: passed. The real OSV.dev blocked Ollama 0.40.10 without its exceptions, on 7 Go advisories, GO-2025-4251 first, and no pod was created.
- `unfit`: 0.7 s later, `availability=NONE`: Runpod offered the RTX 4090 only with CUDA 13.2, and no host had room.

So vLLM 0.32.0's CUDA 13.0 floor narrows the hosts a vLLM pod can start on, on Secure Cloud. The live test and part 2 should expect it.

Next: `vllm` and `unfit` again, when a GPU type of the list has room with CUDA 13.0. Step 3 is done when `vllm` passes; step 4 when `unfit` does.

Decisions 11 and 12 are in `d93b1aa`: with `--gpu=auto`, the default, each check reads the catalog of 8 GPU types of 16 to 24 GB on Secure Cloud and, by default, Community Cloud, and takes the cheapest with room, trying up to 3. The cap of $1 holds for the whole run, counting the pods still running. `b002870` and `d25cba5` give the workflow the `community` input and the same GPU types. Only `NVIDIA GeForce RTX 4090` and `NVIDIA RTX A5000` are known to Runpod's catalog; a wrong ID is skipped.

Next: dispatch `vllm,unfit` with the defaults.
