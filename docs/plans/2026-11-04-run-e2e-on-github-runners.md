---
status: pending
created_at: 2026-11-04T14:47:33-03:00
updated_at: 2026-11-04T18:00:00-03:00
commit: 1492654
---

# Run the e2e suite on GitHub's runners

## Goal

The maintainer starts the e2e suite by hand on GitHub's runners, so it no longer takes over a developer's machine, and a part of it runs on a real GPU, so problems that only a GPU shows appear before a live test on a provider.

## Context

- The suite runs only on a developer's machine ([decision 6 of the e2e plan](2026-10-20-end-to-end-test-suite.md), which left CI to its own plan). A session takes most of a 10 GB Docker VM.
- Its pods run the real engines on the CPU, with a tiny model. [The suite's page](../development/e2e/suite.md#what-it-does-not-cover) lists vLLM on a GPU and the production vLLM image as not covered, and the tee fakes Ollama's `size_vram`.
- [Part 2](2026-10-30-start-pods-from-official-engine-images.md#handover) needs [measurements only a GPU gives](2026-10-30-investigate-multi-service-pods.md#what-only-a-gpu-can-tell).

The two goals need different runners. Freeing the machine needs no GPU:

| | Standard (`ubuntu-latest`) | GPU-powered larger runner |
| --- | --- | --- |
| Hardware | 4 vCPU, 16 GB RAM, 14 GB SSD | 4 vCPU, 28 GB RAM, 176 GB SSD, Tesla T4 with 16 GB |
| Price on a public repository | Free, unlimited | $0.052 per minute, Linux; about $1.56 for 30 minutes |
| Available on GitHub Team | Yes | Yes; needs a payment method and a spending limit above zero |
| Maximum job | 6 hours | 6 hours |

Sources, read on 2026-11-04, to be saved in step 1: [larger runners](https://docs.github.com/en/actions/reference/runners/larger-runners), [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [access control](https://docs.github.com/en/actions/how-tos/manage-runners/larger-runners/control-access).

### What is not known yet

- Whether GitHub's Ubuntu image for the GPU size has NVIDIA's driver and Docker's NVIDIA runtime. The pages do not say. A partner image, "NVIDIA GPU-Optimized VMI", exists. Step 3 finds out.
- Whether larger runners on a public repository draw from the plan's $18 of included compute. The billing pages say such use is billed per minute, and do not say whether it draws from that amount.
- Whether the suite fits a standard runner's disk. The two pod images alone take about 16 GB locally, against the documented 14 GB. Step 4 measures it.
- How long the full suite takes on 4 vCPU. It takes 134 minutes on the maintainer's machine, with 8 CPUs, so a run on 4 vCPU may approach the 6-hour limit. On the GPU runner, 134 minutes would cost about $7.

### Risk: forks on a public repository

A pull request from a fork runs the workflows as the pull request changed them, so it could name the GPU runner in `runs-on` and spend on it. GitHub's warning about this is attached to fixed IP ranges; that the mechanism applies without one is this plan's reading, not a statement of the pages. A `workflow_dispatch` trigger on our own workflow does not close it. Decision 1 does.

### What a GPU runner does not replace

The [live test](2026-10-30-start-pods-from-official-engine-images.md#handover) stays:
- Runpod's and Salad's real APIs, workers, proxy and billing;
- the real `nodejs.org` and `raw.githubusercontent.com` downloads, and GitHub's real App and OIDC;
- GPUs of other models and sizes: a T4 is one old card with 16 GB, so a model or a fit that needs more waits for the live test.

## Decisions

1. **Where the GPU workflow lives.**
   - a) A small private repository of the organization, whose workflow checks out Codeman at a given ref. No fork can reach the runner, the runner group's default (private repositories only) holds, and the workflow needs no commit on Codeman's `main`. It is one more repository to keep.
   - b) Codeman's public repository. One place, but the runner group must allow public repositories, and the fork risk needs approval for every outside contributor's workflows.

   **Recommendation: a).** No workflow setting then stands between a fork and the organization's bill.
2. **Where the CPU suite runs.**
   - a) `ubuntu-latest`, on Codeman's repository: free, and what frees the machine.
   - b) The GPU runner, for everything: one workflow and enough disk, at $0.052 for every minute.

   **Recommendation: a),** unless step 4 shows the disk does not fit and cannot be freed.
3. **What runs on the GPU.**
   - a) A subset, the scenarios tagged `gpu`: the production images, the real fit, and a start that fails on real memory.
   - b) The whole suite.

   **Recommendation: a).** The other scenarios test Codeman's logic, which a GPU does not change, and each minute costs.
4. **The cost limit.** A budget on the organization's Actions that stops at a fixed amount per month. **Recommendation: $20 per month,** with `timeout-minutes: 60` on the job, raised when a measurement asks for it.
5. **Publishing the branches.** Runners need the code on GitHub, and nothing of `features/multi-service-pods` is pushed.
   - a) Push it once part 1's suite passes locally.
   - b) Push it now.

   **Recommendation: a).** This plan starts after part 1's local run, which does not wait for it.

## Steps

1. **Save the sources.** GitHub's pages above, and `workflow_dispatch`'s, under `docs/web/github/`. Done when the web documentation's tests pass.
2. **Create the runner (maintainer).** GPU-powered, one at most at a time, in a group limited to the repository of decision 1, with the budget of decision 4. Done when the runner shows as ready.
3. **Smoke test the GPU runner.** A one-job workflow, started by hand: `nvidia-smi`, `df -h`, `free -h`, `docker run --gpus all` with the catalog's vLLM image by digest, and one request to a tiny model. Done when this plan records the driver, the runtime, the disk and the minutes it took, and which image to use.
4. **The CPU lane.** `.github/workflows/e2e.yml`, on `workflow_dispatch` only:
   - an input of scenario selectors, read through `env`, never interpolated in a script;
   - `permissions: contents: read`, no secrets, actions pinned by SHA;
   - the suite's report uploaded as an artifact, after checking that it holds no token that outlives the session.

   Done when every scenario passes on `ubuntu-latest`, and this plan records the time and the peak disk.
5. **A GPU mode in the e2e runtime.** The launcher adds `--gpus all`, the allowlist maps to the production images, the tee stops rewriting `size_vram`, and the fake catalog offers the runner's GPU. Done when the unit tests show the default mode unchanged, and `failures` and `pods` scenarios tagged `gpu` start in the mode.
6. **The GPU scenarios.** Tagged `gpu`: a vLLM and an Ollama pod from the production images serving an agent, the fit against real memory, and a model that does not fit. Done when they pass on the runner.
7. **Docs.** [The suite's page](../development/e2e/suite.md) says how to start each lane, what each costs, and drops what the lanes now cover from what it does not cover. Done when the docs tests pass.

Part 2's measurements (sleep mode, NVML, a CUDA context's release, load and swap times) can then use this runner. Its plan decides that.

## Out of scope

- Running the suite on every push, pull request or schedule: it stays manual, as the maintainer asked.
- Replacing the live test on a provider.
- Self-hosted runners and Windows.
- Models that need more than 16 GB.
