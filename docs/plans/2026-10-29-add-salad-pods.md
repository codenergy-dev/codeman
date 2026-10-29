---
status: in progress
created_at: 2026-10-29T10:26:49-03:00
updated_at: 2026-10-29T11:04:05-03:00
commit: 1bdf038
---

# Add Salad pods

## Goal

A `salad-pod` provider serves a task's model on a GPU rented by the hour from SaladCloud, as `runpod-pod` does on Runpod: Codeman creates a one-replica container group running its pod image, shares it among the pool's tasks on the same settings, and deletes it when no lease holds it. Both pod providers gain two settings: `hosts`, the kinds of host a pod may run on (Secure by default, Community when allowed), and `priority`.

## Context

### What Salad offers on demand

SaladCloud's Container Engine runs a container image on a GPU, billed per second at a price per GPU class and priority ([pricing](https://salad.com/pricing/)). What matters to Codeman:

| Topic | Salad | Runpod pods today |
| --- | --- | --- |
| Hosts | **Community Cloud only**: crowd-sourced consumer PCs (RTX 3060 to 5090, 8 to 32 GB) in 190+ countries, under Windows with WSL2 and Hyper-V. Salad Dedicated (RTX PRO 6000) is reserved by contract, not on demand | Secure Cloud only: Runpod's data centers ([decision 6 of the self-hosted inference plan](2026-10-02-self-hosted-inference.md)) |
| Unit | A container group: image, resources, GPU class UUIDs, replica count, priority, restart policy, Container Gateway | A pod |
| Price | Per GPU class and priority (`high`, `medium`, `low`, `batch`), listed by `GET /organizations/{org}/gpu-classes`. vCPU and RAM are included. RTX 4090 at high: US$ 0.44/h from 2026-11-01 | Per GPU type, Secure Cloud |
| Billed | Only while an instance runs: allocation and image download are free | From creation |
| Interruptions | A node can go offline at any time; below `high`, other workloads preempt instances. A replacement starts on another node with an empty disk | Rare |
| Public URL | Container Gateway: `networking.dns`, HTTPS only, the app must listen on IPv6 (`::`), 100 s without a response fails a request, optional auth by the account key | Runpod's proxy, 100 s timeout |
| Self-termination | No scoped key: the API key is the user's and reaches every organization and project they can. IMDS (`169.254.169.254`) can reallocate, recreate or restart the instance, but not stop or delete its group | A pod-scoped key in `RUNPOD_API_KEY` |
| Restart policy | `always`, `on_failure`, `never`. An exit with 0 may restart on the same node; a non-zero exit blocks the node and reallocates. What `never` does on exit is not documented | Not applicable |
| Billing API | **None**: usage is only in the Portal | `GET /v2/billing`, by hour and by pod |
| Hard cap | Prepaid credits; at US$ 0 usage stops "as soon as possible", and overage is invoiced the next month | Prepaid; at US$ 0 pods stop |
| CUDA | Set by the Windows host's driver; the API cannot filter by it | `minCudaVersion` |
| GPU memory | Not a field of `GpuClass`; only in its name, such as `RTX 4090 (24 GB)`, minus a part Windows reserves | `memory` in the catalog |
| API | `https://api.salad.com/api/public`, `Salad-Api-Key` header, 240 requests a minute per key, errors sometimes as HTML | REST v2, Bearer key |
| Docs license | [CC-BY-4.0](https://github.com/SaladTechnologies/salad-cloud-docs): pages can be copied in full | None: own words |

### What changes in Codeman

- `GpuProvider` (`src/inference/gpu.ts`) is meant for several adapters, but has one. Three of its parts assume Runpod: `url(id, port)` is computed from the ID, while Salad gives the URL (`networking.dns`) in the group; `billing` and `billedHours` assume a billing API; the gateway's self-termination (`src/gateway/main.ts`) uses Runpod's pod key.
- `gpuProvider(account, key)` (`src/inference/index.ts`) and the key jobs read one GPU key, `gpu-key`. Salad needs its key plus an organization and a project name, and a task may mix both providers through [profiles](../settings/profiles.md).
- The pod gateway listens on `0.0.0.0`; the Container Gateway reaches it over IPv6.
- Changing the gateway changes both pod images, which are published from `main` by `.github/workflows/pod-image.yml` and pinned by digest in `src/inference/images.ts`.
- Adding inputs to the templates bumps the [template version](../development/guide.md#template-version), which [upgrading](../installation/upgrading.md) must name.

### Risks

- **The repository's code goes to a stranger's PC.** Every prompt, with the code and issues the agent reads, is decrypted inside a container on a consumer machine. Salad isolates it with Hyper-V, watches for host intrusion and rates nodes, and says its network is not a fit for sensitive data ([security](https://salad.com/security/)). The host's owner still controls the hardware. This is what decision 6 of the self-hosted inference plan refused for Runpod's Community Cloud.
- **An orphan group bills until someone deletes it**, since the container cannot delete its own group.
- **Costs are estimates only**, never reconciled with a bill.
- **A pod can vanish mid-task** when its node disconnects; its replacement starts empty.

## Decisions

### 1. Untrusted hosts

| Option | Trade-off |
| --- | --- |
| A. Add `salad-pod`, refused unless the settings also set `community-hosts: allow`, only in the organization's or the repository's settings file (not by `/codeman set` nor a manual run's inputs). Security docs state the risk | Each organization or repository chooses it knowingly; a task cannot switch a private repository to it. One more setting |
| B. Add `salad-pod` with no extra setting; only the docs warn | Simplest, but choosing the provider silently sends code to third-party hosts, against the rule of decision 6 |
| C. Do not add on-demand Salad; only Salad Dedicated's `secure` classes, by contract | Keeps decision 6, but it is not on demand nor hourly, which is the request |

**Recommendation:** A.

**Answer (2026-10-29):** a list instead of a switch: `hosts`, the kinds of host a pod may run on, `[secure]` by default, such as `[secure, community]`. It applies to both pod providers, so it also opens Runpod's Community Cloud when set:

| Provider | `secure` | `community` |
| --- | --- | --- |
| `runpod-pod` | Secure Cloud (today's only choice) | Community Cloud |
| `salad-pod` | GPU classes of type `secure` (Salad Dedicated, by contract) | GPU classes of type `community` |

This replaces decision 6 of the self-hosted inference plan with a setting whose default keeps it. Where `hosts` may be set, and how a list of both picks a host, is decision 9.

### 2. The provider's settings

| Option | Trade-off |
| --- | --- |
| A. `salad-pod`, with `gpu` (required: one GPU class name, such as `"RTX 4090 (24 GB)"`, resolved to its UUID), `pod-reuse`, `engine` and its block, like `runpod-pod`. Priority fixed at `high` | Same settings as Runpod pods. `high` is never preempted by other workloads, so a pod is lost only when its node disconnects |
| B. As A, plus `priority` (`high` by default, or `medium`, `low`, `batch`) | Up to 64% cheaper, but a preempted pod loses its runs mid-task, and lowering the priority of a running group waits an hour |
| C. As A, but `gpu` takes several classes | Allocates faster; the price is the dearest class's and the fit the smallest's, and the pod settings hash grows |

**Recommendation:** A. B and C can follow once a pod's loss is handled better than failing its tasks.

**Answer (2026-10-29):** A, plus a `priority` setting on both pod providers, whose default is the provider's highest, as documented:

| Provider | Values | Default |
| --- | --- | --- |
| `salad-pod` | `high`, `medium`, `low`, `batch` | `high` |
| `runpod-pod` | `on-demand` | `on-demand` |

Runpod's REST API v2 offers no interruptible (spot) pods: `CreatePodRequest` has no such field, and its pricing page no longer lists them. So `runpod-pod` takes only `on-demand` until Runpod offers another. A preempted pod fails its tasks as a failed pod does, which the docs state for priorities below the highest.

### 3. Engines

| Option | Trade-off |
| --- | --- |
| A. Ollama and vLLM | Same as Runpod, but vLLM's image needs CUDA 13.0, which Salad cannot filter for, its image is 9 GB compressed for residential downloads, and its shared memory must be set |
| B. Ollama only, vLLM in a later plan after a live test | Smaller first step; tasks that need vLLM's batching stay on Runpod |

**Recommendation:** B.

**Answer (2026-10-29):** A. Since a host's CUDA cannot be chosen, the pod's gateway checks the driver's CUDA version before it starts vLLM, and reports a failed start that names it.

### 4. Ending a pod

| Option | Trade-off |
| --- | --- |
| A. Create groups with `restart_policy: never`; the gateway exits where it terminates a pod today; the key jobs and the sweep delete groups through the API. Step 2 checks first that an exit with `never` stops the instance without a reallocation | No credential on the host. Should the check fail, the plan becomes `blocked` and this decision is reviewed |
| B. Give the container the account key | Refused: the host's owner could read a key that reaches the whole Salad account |

**Recommendation:** A.

**Answer (2026-10-29):** A. With decision 8, what `never` does is checked live after the plan, in the handover. Until then, a gateway that starts past its start limit, as a reallocated one would, exits at once, and `open-key`'s sweep deletes groups no registry pod holds.

### 5. Cost and budgets

| Option | Trade-off |
| --- | --- |
| A. A run's cost is the pod's time at the listed `high` price, from the group's creation, split as on Runpod. The `salad` account is not hourly: the organization's month counts Codeman's ledger only. The prepaid balance is the hard cap | Overcounts the free image download, so a budget never undercounts. No reconciliation, since Salad has no billing API |
| B. As A, but from the instance's first `running` state | Closer to Salad's bill, but it needs the instance's history, and a reallocation restarts it |

**Recommendation:** A.

**Answer (2026-10-29):** A.

### 6. Credentials

| Option | Trade-off |
| --- | --- |
| A. A secret `CODEMAN_SALAD_API_KEY` (input `salad-key`) and two variables, `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT` (inputs `salad-organization`, `salad-project`), in the key jobs. The installation page asks for a Salad user that only belongs to Codeman's organization | Mirrors Runpod; a template version bump. The key cannot be scoped further: a dedicated user is the only limit |
| B. One secret holding `organization/project/key` | No new variables, but a format to parse and a key mixed with public names |

**Recommendation:** A.

**Answer (2026-10-29):** A.

### 7. Tests

| Option | Trade-off |
| --- | --- |
| A. Unit tests of the adapter on a fake `fetch`, plus a fake Salad in `e2e/fakes/` reusing the fake Runpod's launcher, and one scenario: a task on `salad-pod` from its label to its end | Covers the lifecycle where bugs hide: the URL known after creation, the exit, the delete, the sweep |
| B. Unit tests only | Less work; the flow is covered only by the live test |

**Recommendation:** A.

**Answer (2026-10-29):** A.

### 8. Paid resources and publishing

The steps below need the responsible person's authorization, each once:

- **A live probe** before the adapter: a CPU-only container group (about US$ 0.01 an hour) on their Salad account, with their key, for under an hour.
- **Publishing the pod images:** pushing the gateway's change to `main`, which runs the image workflow.
- **A live test:** one task with a small model on a cheap GPU class at `high`, under US$ 1.

**Recommendation:** authorize all three; without the probe, decision 4 rests on an assumption.

**Answer (2026-10-29):** none during the plan. Once it is completed, the responsible person pushes, publishes the images and tests live; what does not work as expected reopens the plan. So the adapter is written from the documentation alone, and what it could not confirm is the [handover](#handover) checklist (step 9).

### 9. Where `hosts` is set, and how a list picks a host

| Option | Trade-off |
| --- | --- |
| A. Only in the organization's and the repository's settings files, at the top level and in profiles, not by `/codeman set` nor a manual run's inputs, as `concurrency` is. The list's order is a preference: Codeman creates the pod on the first kind that offers the GPU with room, then the next. Its cost is the rate the provider bills the pod (Runpod's `cost`), not a list price. The list is part of the [pod settings](../glossary.md#pod-settings) | A task cannot send a private repository's code to third-party hosts. `[community, secure]` prefers the cheaper hosts, `[secure, community]` the safer ones |
| B. In every layer, task commands included | A maintainer can try Community Cloud on one task, but any task command can then widen where code goes |

**Recommendation:** A. On Salad each GPU class has one type, so `hosts` only allows or refuses the class `gpu` names.

**Answer (2026-10-29):** A.

## Steps

Each step ends with `npm run check` passing (lint, types, tests and the build, `dist/` committed rebuilt), and is one commit.

1. **Record the documentation.** Copy in full (CC-BY-4.0) into `docs/web/salad/` the Salad pages this plan relies on, its OpenAPI operations included, with a tool page `docs/web/tools/salad.md`; add the Runpod pages on Community Cloud that are missing. Done when each fact in Context points to a recorded page.
2. **Generalize the GPU interfaces and the gateway.** A pod carries its URL, known once it is created; billing is optional; how a pod ends itself is the provider's (Runpod's pod key, or exiting); the gateway listens on `::`, which serves IPv4 too; `gpuProvider` takes an account's settings, not one key; before it starts vLLM, the gateway reads the driver's CUDA version and fails the start, naming it, when it is older than vLLM's image needs. Done when Runpod behaves as before and every test passes.
3. **Add `hosts` and `priority` to `runpod-pod`** (decisions 1, 2, 9). `hosts` is read only from the settings files, at the top level and in profiles; a `/codeman set` or a manual run's input that sets it is refused. The Runpod adapter creates the pod on the first kind of the list whose hosts have room (`cloud: SECURE` or `COMMUNITY`), and a run's cost uses the pod's billed `cost`. Both settings join the pod settings hash. Done when the defaults leave today's pods and their hash unchanged, and tests cover a Community pod and the refused commands.
4. **Write the Salad adapter**, `src/inference/salad.ts`, with unit tests on a fake `fetch`: the GPU class by name, refused when its type is not in `hosts`; its price at the priority; its memory from its name; create (one replica, the priority, `restart_policy: never`, the Container Gateway without auth on the gateway's port, the disk, the shared memory vLLM needs); get, list by environment, delete (`404` is not an error), status mapping from the group's and its instance's states; no billing. Done when its tests pass.
5. **Add the provider** `salad-pod` and the account `salad` (not hourly) to the registry, with the inputs `salad-key`, `salad-organization` and `salad-project` in `action.yml`, the secret and variables in the templates, and the template version bump (decision 6). A run on an image whose gateway cannot serve on Salad stops before any group is created, as Ollama settings do today. Done when settings checks, key jobs and template tests pass.
6. **Cost Salad pods** as decision 5 says, in `close-key`, the spend table and the organization's month. Done when tests show a Salad run's estimate, with no billing read.
7. **Test end to end** (decision 7): a fake Salad in `e2e/fakes/salad/` that runs pods with the fake Runpod's launcher, and a scenario of one task on `salad-pod` from its label to its end, its group deleted. Done when the suite passes.
8. **Document it:** `docs/installation/salad.md`; providers, self-hosted inference, pods, spend and budget pages; `hosts` and `priority` in the settings reference; security risks and secrets, with decision 6 of the self-hosted inference plan now a default; glossary; upgrading, with the template version; the docs index. Done when the docs test passes and no page says pods are only Runpod's or only on Secure Cloud.
9. **Write the handover**, below: what the responsible person does after the plan, and what to check live. Done when it lists every assumption the adapter makes that the docs did not settle.

## Handover

Written in step 9.

## Out of scope

- Contracting Salad Dedicated: `hosts: [secure]` uses its classes when an organization has them, but no test covers them.
- `hosts` on `runpod-serverless`: an endpoint's cloud is set in Runpod's console and cannot be read ([the self-hosted inference plan](2026-10-02-self-hosted-inference.md)).
- Salad's AI Gateway (pay per token, like OpenRouter), job queues and inference endpoints.
- Several GPU classes per pod.
- Restricting the countries a pod may run in (`country_codes`).
- Surviving a node's loss: its tasks fail as a failed pod's do.
