# Glossary

The terms the docs use, one meaning each. A term with several meanings points to its qualified forms; use those.

## A

### Agent run

One stage of one task: one agent, run by the harness in the task's `agent` job, with its own task key or run token. See [stages](tasks/stages.md).

### Attribute condition

The expression on the Workload Identity provider that decides which GitHub OIDC tokens reach the backend: those of the organization's repositories, or of listed ones, from `codeman.yml` on the default branch. It is not a profile condition. See [installation](installation/setup.md#4-set-up-the-backend).

## B

### Backend

The Firebase project, with Cloud Firestore, where Codeman keeps what its jobs share across runs and repositories. Tasks' state stays on GitHub. See [backend](backend/backend.md).

### Batch

The tasks that run at once with the same resolved settings. On a pod, a batch may take tasks of the pool's other repositories; on OpenRouter and Serverless, it is the tasks of one workflow run that take the profile. See [batches across repositories](runs/batches.md).

### Board

The pool's index of ready tasks that a pod profile could serve, one snapshot per repository, from which `select` forms batches. GitHub stays the source of truth. See [the board](runs/batches.md#the-board).

## C

### Cache of fits

The contexts that fitted a pod's image, model, GPU type and engine settings before, kept in the backend. The task that creates a pod reads it, and records what the pod found after a search. See [Ollama's memory](settings/ollama.md#memory) and [vLLM's](settings/vllm.md#memory).

### Capacity

The most runs a pod serves at once: its parallel requests. A task that finds every pod of its settings full creates another. See [shared pods](inference/pods.md#shared-pods).

### Change request

The name the platform interface gives a pull request, so that other platforms can map theirs. On GitHub, it is a pull request. See [platforms](development/platforms.md).

### Codeman's commit

The commit of Codeman that every job checks out and runs: a full SHA on Codeman's `main`, in the `CODEMAN_COMMIT_SHA` variable. It is what a "version of Codeman" means. See [installation](installation/setup.md#5-add-the-workflow-and-settings).

### Condition

Always qualified: an [attribute condition](#attribute-condition), on the backend's Workload Identity provider, or a [profile condition](#profile-condition), in the settings.

### Context

The tokens one request can hold. A pod serves the largest context that fits its GPU, at least 64000 tokens or the model's own when smaller, and the agent is told it. See [Ollama's memory](settings/ollama.md#memory).

### Count

The size of a batch, from 1 to 10, which a profile's `tasks`, `min-tasks` and `max-tasks` conditions test. The counts also decide how many tasks a workflow run takes. See [profiles](settings/profiles.md#conditions).

## E

### Engine

What serves the model on a pod: Ollama or vLLM, chosen with `engine`. A Serverless endpoint runs Runpod's vLLM worker. See [providers](settings/providers.md#runpod-pod).

## F

### Fit

The context and parallel requests at which a pod's model and its K/V cache fit wholly on the GPU. The pod's gateway finds it as the pod starts, and `open-key` logs it. See [Ollama's memory](settings/ollama.md#memory) and [vLLM's](settings/vllm.md#memory).

## G

### Gateway

Codeman's program in front of a self-hosted engine: it holds the runs' tokens and limits, records each request, and splits a pod's time. It runs in the pod, or, for Serverless, in the agent job. See [the gateway](inference/self-hosted.md#the-gateway).

### Gateway run

A run as the gateway serves it: one task's token, limit and request records. On a pod, each task has its own, named by its seat. See [the gateway](inference/self-hosted.md#the-gateway).

## H

### Harness

The program that runs the agent in the sandbox, with the model and the task file: OpenCode today. See [the agent harness](development/dependencies.md#agent-harness-opencode).

## I

### Inference provider

Where an agent run's model is served, chosen with `provider`: `openrouter`, `runpod-pod` or `runpod-serverless`. It is not the Workload Identity provider. See [providers](settings/providers.md).

## K

### Kept time

A second of a shared pod with no run on it, which goes to the tasks that keep the pod then. See [shared pods](inference/pods.md#shared-pods).

### Key jobs

`open-key`, `close-key` and `release-pod`: the jobs that open and end runs' access to their models, and the only ones that hold OpenRouter's management key and the GPU account's key. See [jobs](runs/runs-and-jobs.md#jobs).

## L

### Layer

One source of settings, in this order: Codeman's defaults, the organization's settings, `.codeman/settings.yml`, a manual run's inputs, the profile that applies, and a task's `/codeman set`. Each layer inherits what the layers before it resolve to, and may override any of it. See [settings](settings/reference.md).

### Lease

A task's hold in the pod registry: a creation lease on a pod's settings while the task creates the pod (5 minutes), a run lease while its run is open (2 hours at most), or a keep lease after the run (15 minutes). A pod that no unexpired lease holds is terminated. See [pods](inference/pods.md).

### Ledger

The backend's records of agent runs and of what the jobs did, which the budgets read. See [the ledger](backend/backend.md#the-ledger).

### Ledger run

The ledger's document of one agent run, with its status, limit and cost. Its ID is `{workflow run}-{attempt}-{task}`. See [data layout](backend/data-layout.md).

## M

### Maintainer

A user with admin or write permission on the repository; GitHub reports maintain as write. Only maintainers' issues are tasks, and only their comments count. See [commands](tasks/commands.md).

## O

### Organization's settings

The settings an organization shares with its repositories, in its `CODEMAN_SETTINGS` variable, which the template passes as `select`'s `settings` input. They are the second layer, and the only one that sets `organization-monthly-budget` and `pool`. See [shared settings](installation/shared-settings.md).

## P

### Parallel requests

How many requests a pod's engine serves at once: Ollama's `num-parallel` or vLLM's `max-num-seqs`. Without one, it is the most tasks the pod's profile serves. See [parallel requests](settings/ollama.md#parallel-requests).

### Pinned pod image

The image of an engine that pods run, pinned by digest in `POD_IMAGES`, not the latest build. A change to the gateway reaches pods only once its new digest is pinned. See [pod images](development/guide.md#pod-images).

### Pod

A GPU machine that Codeman creates on Runpod's Secure Cloud, with Codeman's image for its engine, to serve the pool's tasks with the same pod settings. Runpod bills every second it exists. See [pods](inference/pods.md).

### Pod registry

The pool's documents of its pods in the backend: each pod's settings, capacity, batch, seats and leases. See [pods](inference/pods.md).

### Pod settings

The hash of what a pod serves: its model, GPU type, image and `pod-reuse`, and its engine's settings with their derived values. Tasks share a pod only when their pod settings are the same. See [pods](inference/pods.md).

### Pool

Always qualified: a [Workload Identity pool](#workload-identity-pool), in Google Cloud, or a [pool of organizations](#pool-of-organizations), in the settings.

### Pool of organizations

A closed list of organizations, set by `pool` in their settings, that share the board, the batches, the pod registry and one Runpod account. Without `pool`, an organization is a pool alone. See [pools](runs/batches.md#pools).

### Profile

An entry of `profiles`: a name, profile conditions, and the provider, model and provider settings it changes. The first profile whose conditions all hold applies to an agent run. See [profiles](settings/profiles.md).

### Profile condition

A profile's `stages`, `tasks`, `min-tasks` or `max-tasks`, which decide when it applies. It is not an attribute condition. See [conditions](settings/profiles.md#conditions).

### Provider

Always qualified: an [inference provider](#inference-provider), in the settings, or the [Workload Identity provider](#workload-identity-provider), in Google Cloud.

## R

### Reservation

Always qualified. A budget reservation is a run's limit, which `open-key` writes in the ledger before it opens the run ([budget](budget/budget.md)); a batch reservation is a task that another repository's batch reserved for this repository's next run ([reservations](runs/batches.md#reservations)).

### Routed stage

A stage that the routing stage may choose: web, design, code, test, or review, which always runs last. See [routing](tasks/stages.md#routing).

### Run

Always qualified: a [workflow run](#workflow-run), an [agent run](#agent-run), a [ledger run](#ledger-run) or a [gateway run](#gateway-run). A request on a Serverless endpoint's queue is a [Serverless job](#serverless-job).

### Run token

The random token of an agent run on a self-hosted gateway, in place of a task key. It opens only its own gateway run, and ending that run revokes it. See [the gateway](inference/self-hosted.md#the-gateway).

## S

### Sandbox

How the agent job isolates the agent: it runs as the `codeman-agent` user, without `sudo`, on a copy of the checkout, with a rebuilt environment. It protects the job's credentials, not the runner. See [agent sandbox](runs/agent.md#agent-sandbox).

### Seat

A task's position on a pod, given when the task first joins it and kept for the pod's life. The gateway names the task's runs by it. See [shared pods](inference/pods.md#shared-pods).

### Serverless job

One request that the gateway queues on a Serverless endpoint (`/run`), then reads until it ends. It is not a workflow job. See [Serverless](inference/serverless.md).

### Stage

One of the seven steps of a task that an agent runs: `plan`, `route`, `web`, `design`, `code`, `test` and `review`. Every agent run is a stage; recording answers and accepting workflows are not. See [stages](tasks/stages.md).

### Status comment

The comment that Codeman keeps up to date on a task's issue, also called its panel: where the task is, what comes next, and what it spent. It holds the task record. See [comments](tasks/comments.md#status-and-run-comments).

### Store

The interface through which the steps read and write the backend, with transactions; on Firestore, or in memory for tests. See [the store](backend/backend.md#the-store).

## T

### Task

An open issue with the `codeman` label, opened by a maintainer. See [task lifecycle](tasks/lifecycle.md#tasks-and-states).

### Task branch

The branch of a task's work, `codeman/<issue>-<slug>`, where Codeman commits the plan and the agent's changes. See [planning](tasks/stages.md#planning).

### Task key

The OpenRouter key of one agent run, limited to what remains of the task's budget and disabled when the run ends. It is named `codeman/<owner>/<repo>/<issue>/<run>`. See [OpenRouter](inference/openrouter.md).

### Task record

The task's state beyond its labels, such as its branch, decisions, answers and spend, kept in a hidden block of the status comment. See [comments](tasks/comments.md#status-and-run-comments).

### Template version

The version of the workflow templates a repository copied, which every Codeman step passes as `template-version`. A Codeman commit that expects another version fails at its first job. See [template version](development/guide.md#template-version).

### Top level

The settings outside `profiles`; for a run, what the first four layers resolve to, which is each profile's base. With a `model`, it serves the agent runs that no profile serves. See [settings](settings/reference.md).

## U

### Untracked time

The part of a pod's life, at its price, that no ledger run counts, such as the time after its tasks' last closes. It counts only in the organization's month. See [self-hosted runs](budget/spend.md#self-hosted-runs).

## V

### Version

Always qualified: [Codeman's commit](#codemans-commit), the [template version](#template-version), or a [pinned pod image](#pinned-pod-image).

## W

### Workflow run

One run of the `codeman.yml` workflow: `select`, then the jobs of each task it picked, at once, then `next-run`. A repository has one active at a time, with as many tasks as the profiles' counts allow. See [runs](runs/runs-and-jobs.md#runs).

### Workload Identity pool

The Google Cloud pool, `codeman`, whose identities may act as the backend's service account. It is not a pool of organizations. See [installation](installation/setup.md#4-set-up-the-backend).

### Workload Identity provider

The pool's OIDC provider, `github`, which admits the GitHub tokens that pass its attribute condition. It is not an inference provider. See [installation](installation/setup.md#4-set-up-the-backend).
