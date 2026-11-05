---
status: in progress
created_at: 2026-11-04T14:47:33-03:00
updated_at: 2026-11-05T16:24:00-03:00
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

## Secrets and what a public repository shows

What each check needs to see, and nothing else:

| Check | Secret | Variable |
| --- | --- | --- |
| The suite on `ubuntu-latest` | None: every key is a fake's | None |
| Real pod, on Runpod | `CODEMAN_RUNPOD_API_KEY`, in the `e2e-live` environment | None: the GPU type and model are the workflow's inputs |
| Real pod, on Salad, later | `CODEMAN_SALAD_API_KEY`, in `e2e-live` | `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT`, in `e2e-live` |

The names are those of [the templates](../../templates/codeman-task.yml). The `e2e-live` environment admits only the branches `main`, `features/*` and `fixes/*`. Other keys the check uses, such as the encryption secret and the gateway's tokens, are made for the run and registered as masks.

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

On 2026-11-05 the maintainer pushed it and opened its pull request. CI failed in one test, unrelated to the branch: `ubuntu-latest` is moving to Ubuntu 26.04 until 2026-11-19 ([announcement](https://github.com/actions/runner-images/issues/14748)), and its `systemd-udevd` 259 binds an abstract socket that the sandbox test has not reviewed. Codeman's sandbox was reviewed on Ubuntu 24.04 only. Waits for the maintainer's decision.

Next: the maintainer merges it, then dispatches it on `main`. Record each group's time and peak disk here.
