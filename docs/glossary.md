# Glossary

The terms the docs use, one meaning each. A term with several meanings points to its qualified forms; use those.

## A

### Account

Always qualified: the OpenRouter account, whose credits the task keys spend; the [GPU account](#gpu-account), on Runpod; or the backend's [service account](#service-account), in Google Cloud. A GitHub user account counts as its own organization.

### Account fingerprint

How Codeman names a [GPU account](#gpu-account) without its key: the first 16 hex characters of an HMAC-SHA256 of a fixed label with the [Runpod API key](#runpod-api-key). A pod's registry document and environment carry it, so a task joins only pods of its own account. See [pods](inference/pods.md).

### Action

What `select` makes a workflow run do for a task: `plan`, `route`, `implement` (a routed stage), `record` (apply the maintainers' answers) or `accept` (move the accepted workflows). It is `none` when nothing can move. It is not a GitHub Action. See [jobs](runs/runs-and-jobs.md#jobs).

### Admin token

The token that manages a pod's gateway, on `/usage` and the `/admin/` routes: an HMAC of the [Runpod API key](#runpod-api-key) and the pod's nonce. Only the [key jobs](#key-jobs) can derive it; the pod keeps only its hash. See [the admin token](inference/self-hosted.md#the-admin-token).

### Agent run

One stage of one task: one agent, run by the harness in the task's `agent` job, with its own task key or run token. See [stages](tasks/stages.md).

### App token

A token of the [GitHub App](#github-app)'s installation, which a job requests with the App's private key, with only the permissions it needs. The token action revokes it when the job ends. See [secrets](security/secrets.md#github-app-private-key).

### Attribute condition

The expression on the Workload Identity provider that decides which GitHub OIDC tokens reach the backend: those of the organization's repositories, or of listed ones, from `codeman.yml` on the default branch. It is not a profile condition. See [installation](installation/setup.md#4-set-up-the-backend).

## B

### Backend

The Firebase project, with Cloud Firestore, where Codeman keeps what its jobs share across runs and repositories. Tasks' state stays on GitHub. See [backend](backend/backend.md).

### Base

What a [layer](#layer) applies its values over: what the layers before it resolve to. A value the layer does not set is the base's. A profile's base is the [top level](#top-level). See [layers](settings/reference.md#layers).

### Batch

The tasks that run at once with the same resolved settings. On a pod, a batch may take tasks of the pool's other repositories; on OpenRouter and Serverless, it is the tasks of one workflow run that take the profile. See [batches across repositories](runs/batches.md).

### Board

The pool's index of ready tasks that a pod profile could serve, one snapshot per repository, from which `select` forms batches. GitHub stays the source of truth. See [the board](runs/batches.md#the-board).

### Brief

The routing agent's instructions to one routed stage it chooses. The routing stage's run comment shows each brief. See [routing](tasks/stages.md#routing).

## C

### Cache of fits

The contexts that fitted a pod's image, model, GPU type and engine settings before, kept in the backend. The task that creates a pod reads it, and records what the pod found after a search. See [Ollama's memory](settings/ollama.md#memory) and [vLLM's](settings/vllm.md#memory).

### Capacity

The most runs a pod serves at once: its parallel requests. A task that finds every pod of its settings full creates another. See [shared pods](inference/pods.md#shared-pods).

### Change policy

The rules by which `apply` keeps or drops each path the agent changed, stages the workflows it wrote, and commits the rest to the [task branch](#task-branch). See [change policy](runs/changes.md#change-policy).

### Change request

The name the platform interface gives a pull request, so that other platforms can map theirs. On GitHub, it is a pull request. See [platforms](development/platforms.md).

### Codeman's commit

The commit of Codeman that every job checks out and runs: a full SHA on Codeman's `main`, in the `CODEMAN_COMMIT_SHA` variable. It is what a "version of Codeman" means. See [installation](installation/setup.md#5-add-the-workflow-and-settings).

### Condition

Always qualified: an [attribute condition](#attribute-condition), on the backend's Workload Identity provider, or a [profile condition](#profile-condition), in the settings.

### Context

The tokens one request can hold. A pod serves the largest context that fits its GPU, at least 64000 tokens or the model's own when smaller, and the agent is told it. See [Ollama's memory](settings/ollama.md#memory).

### Contract tests

The tests that every [store](#store) must pass ([`src/store/contract.ts`](../src/store/contract.ts)): the store in memory always, and Firestore's emulator when it runs. See [Firestore's emulator](development/guide.md#firestores-emulator).

### Count

The size of a batch, from 1 to 10, which a profile's `tasks`, `min-tasks` and `max-tasks` conditions test. The counts also decide how many tasks a workflow run takes. See [profiles](settings/profiles.md#conditions).

## E

### Engine

What serves the model on a pod: Ollama or vLLM, chosen with `engine`. A Serverless endpoint runs Runpod's vLLM worker. See [providers](settings/providers.md#runpod-pod).

### Engine block

The `ollama` or `vllm` block of the settings, whose keys tune a pod's [engine](#engine). A layer or profile that names another provider drops it, and one that names another engine drops the other engine's block. See [the block](settings/pod-engines.md#the-block).

### Estimate

A run's cost that Codeman computes rather than reads from a bill: a Serverless run's share of the worker's estimated time, or a pod run's time when its gateway cannot report its share. The organization's [month](#month) reconciles the estimates with Runpod's hourly billing. See [self-hosted runs](budget/spend.md#self-hosted-runs).

Ollama's context estimate is not a cost: it is a first guess at the [fit](#fit) ([Ollama's memory](settings/ollama.md#memory)).

## F

### Federated token

The token that Google's Security Token Service gives a job in exchange for its [OIDC token](#oidc-token), through the [Workload Identity provider](#workload-identity-provider). The job exchanges it in turn for the [service account](#service-account)'s access token. See [access](backend/backend.md#access).

### Fit

The context and parallel requests at which a pod's model and its K/V cache fit wholly on the GPU. The pod's gateway finds it as the pod starts, and `open-key` logs it. See [Ollama's memory](settings/ollama.md#memory) and [vLLM's](settings/vllm.md#memory).

### Fixed order

The routed stages in their order, which run without a route when the routing agent's result cannot be used. They start at design when the task was just planned, and at code otherwise, so web never runs. See [when its result cannot be used](tasks/stages.md#when-its-result-cannot-be-used).

### Flex price

Runpod's price for a Serverless flex worker: a worker that scales to zero when idle. Codeman prices a Serverless run at the flex price of the endpoint's dearest GPU type, times its GPUs per worker. See [what a run costs](inference/serverless.md#what-a-run-costs).

### Floor

The least [context](#context) a pod gives an agent: 64000 tokens, or the model's own context when smaller. When the model does not fit even at the floor, the pod's start fails. See [context and the GPU](settings/pod-engines.md#context-and-the-gpu).

## G

### Gateway

Codeman's program in front of a self-hosted engine: it holds the runs' tokens and limits, records each request, and splits a pod's time. It runs in the pod, or, for Serverless, in the agent job. See [the gateway](inference/self-hosted.md#the-gateway).

### Gateway run

A run as the gateway serves it: one task's token, limit and request records. On a pod, each task has its own, named by its seat. See [the gateway](inference/self-hosted.md#the-gateway).

### GitHub App

The App that a maintainer registers for Codeman, under the owner that runs it. Codeman's jobs act as it, with [App tokens](#app-token), rather than with the workflow's `GITHUB_TOKEN`. Its private key is the `CODEMAN_GITHUB_APP_PRIVATE_KEY` secret. See [installation](installation/setup.md#1-register-the-github-app).

### GPU account

The Runpod account that the [Runpod API key](#runpod-api-key) opens: where pods run, and whose billing the organization's [month](#month) reads. A [pool of organizations](#pool-of-organizations) shares one. See [accounts](settings/providers.md#accounts).

## H

### Harness

The program that runs the agent in the sandbox, with the model and the task file: OpenCode today. See [the agent harness](development/dependencies.md#agent-harness-opencode).

## I

### Inference provider

Where an agent run's model is served, chosen with `provider`: `openrouter`, `runpod-pod` or `runpod-serverless`. It is not the Workload Identity provider. See [providers](settings/providers.md).

## K

### Kept time

A second of a shared pod with no run on it, which goes to the tasks that keep the pod then. See [shared pods](inference/pods.md#shared-pods).

### Key encryption secret

`CODEMAN_KEY_ENCRYPTION_SECRET`: `open-key` encrypts the run's task key or run token with it, and Codeman's step in `agent` decrypts it. So the credential travels between jobs encrypted. See [secrets](security/secrets.md#key-encryption-secret).

### Key jobs

`open-key`, `close-key` and `release-pod`: the jobs that open and end runs' access to their models, and the only ones that hold OpenRouter's management key and the GPU account's key. See [jobs](runs/runs-and-jobs.md#jobs).

### K/V cache

The engine's memory of the tokens that each request in progress holds, beside the model on the GPU. It grows with the parallel requests times the context. A quantized cache takes less memory, with some loss of precision. See [context and the GPU](settings/pod-engines.md#context-and-the-gpu).

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

### Management key

`CODEMAN_OPENROUTER_MANAGEMENT_KEY`: the OpenRouter key that creates, lists and changes the account's other keys. Only `open-key` and `close-key` hold it, to create and end [task keys](#task-key). See [secrets](security/secrets.md#openrouter-management-key).

### Manual run's inputs

The inputs of a manual run of `codeman.yml`: `model`, `task-budget`, `monthly-budget` and `max-runs`. They are the fourth [layer](#layer). Scheduled and comment runs have none. The `batch` input, set when another repository's batch starts the run, is only logged. See [layers](settings/reference.md#layers).

### Month

Always qualified, and always a calendar month in UTC. A ledger run counts in the month in which `select` picked it.

- The repository's month: what its runs spent, against `monthly-budget`.
- The organization's month: what all its repositories' runs spent, reconciled with the GPU accounts' billing, against `organization-monthly-budget`.

See [the three budgets](budget/budget.md#the-three-budgets).

## O

### OIDC token

The token that GitHub gives a job granted `id-token: write`, which proves its repository and workflow. Only `select`, `open-key`, `close-key` and `release-pod` request it, to reach the [backend](#backend). See [access](backend/backend.md#access).

### Organization's settings

The settings an organization shares with its repositories, in its `CODEMAN_SETTINGS` variable, which the template passes as `select`'s `settings` input. They are the second layer, and the only one that sets `organization-monthly-budget` and `pool`. See [shared settings](installation/shared-settings.md).

### Orphan pod

A pod of the [GPU account](#gpu-account) that Codeman created for the pool, or for the organization before pools, but that no live document of the [pod registry](#pod-registry) holds. `open-key` terminates it when it sweeps the account. Pods without Codeman's environment are never touched. See [sweeping orphans](inference/pods.md#sweeping-orphans).

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

### Provider settings

The settings that only some [inference providers](#inference-provider) take: `engine`, `gpu`, `endpoint` and `pod-reuse`, and the [engine blocks](#engine-block). A layer or profile that names another provider keeps none of the inherited ones. See [provider settings across layers](settings/provider-settings-across-layers.md).

## R

### Reservation

Always qualified. A budget reservation is a run's limit, which `open-key` writes in the ledger before it opens the run ([budget](budget/budget.md)); a batch reservation is a task that another repository's batch reserved for this repository's next run ([reservations](runs/batches.md#reservations)).

### Review round

One `changes` from review. When the rounds in a row exceed `max-runs`, the task is blocked. The count starts over when review passes, and in the runs that carry out a `fix` request. See [runs in a row and review rounds](tasks/stages.md#runs-in-a-row-and-review-rounds).

### Routed stage

A stage that the routing stage may choose: web, design, code, test, or review, which always runs last. See [routing](tasks/stages.md#routing).

### Run

Always qualified: a [workflow run](#workflow-run), an [agent run](#agent-run), a [ledger run](#ledger-run) or a [gateway run](#gateway-run). A request on a Serverless endpoint's queue is a [Serverless job](#serverless-job).

### Run token

The random token of an agent run on a self-hosted gateway, in place of a task key. It opens only its own gateway run, and ending that run revokes it. See [the gateway](inference/self-hosted.md#the-gateway).

### Runpod API key

`CODEMAN_RUNPOD_API_KEY`, the key of the [GPU account](#gpu-account); the docs also call it the account key or the GPU account key. Only the [key jobs](#key-jobs) hold it: to create and end pods, derive their [admin tokens](#admin-token), and read the account's billing. See [secrets](security/secrets.md#runpod-api-key).

### Run's cap

The most tasks a [workflow run](#workflow-run) takes: the largest `tasks` or `max-tasks` of the profiles, or 10 when a profile has `min-tasks` alone. It is 1 when no profile has a [count](#count). A pod's parallel requests default to it when its profile names no `tasks` or `max-tasks`. See [parallel requests](settings/pod-engines.md#parallel-requests).

### Runs in a row

The runs of the same routed stage that end unfinished, `partial` or out of time, one after another. The `max-runs`th blocks the task. The count starts over when another stage runs, or when a `fix` or `continue` request resumes the task. See [runs in a row and review rounds](tasks/stages.md#runs-in-a-row-and-review-rounds).

## S

### Sandbox

How the agent job isolates the agent: it runs as the `codeman-agent` user, without `sudo`, on a copy of the checkout, with a rebuilt environment. It protects the job's credentials, not the runner. See [agent sandbox](runs/agent.md#agent-sandbox).

### Seat

A task's position on a pod, given when the task first joins it and kept for the pod's life. The gateway names the task's runs by it. See [shared pods](inference/pods.md#shared-pods).

### Secure Cloud

Runpod's certified data centers. Codeman creates pods there only. A [Serverless endpoint](#serverless-endpoint) runs where the maintainer who created it chose, which Runpod's API does not report. See [self-hosted inference on Runpod](installation/runpod.md).

### Serverless endpoint

A Runpod endpoint that a maintainer creates from Runpod's vLLM worker, named by the `endpoint` setting of `runpod-serverless`. Its workers start on demand. The gateway queues each request on it as a [Serverless job](#serverless-job). See [Serverless](inference/serverless.md).

### Serverless job

One request that the gateway queues on a Serverless endpoint (`/run`), then reads until it ends. It is not a workflow job. See [Serverless](inference/serverless.md).

### Serverless key

`CODEMAN_RUNPOD_SERVERLESS_KEY`, a Runpod key restricted to the [Serverless endpoint](#serverless-endpoint). Only Codeman's step in `agent` holds it, for the gateway; the agent gets only its [run token](#run-token). See [secrets](security/secrets.md#runpod-serverless-key).

### Service account

The backend's Google Cloud identity, `codeman@<project ID>.iam.gserviceaccount.com`, with the Cloud Datastore User role. Jobs act as it for an hour, through Workload Identity Federation; it has no stored key. See [access](backend/backend.md#access).

### Settings key

The hash of what serves a task at a [count](#count): the profile, provider, model and provider settings, and on a pod the parallel requests. Tasks with the same count and settings key form a [batch](#batch). It is not an OpenRouter key, nor the [pod settings](#pod-settings), which also hash the image. See [forming batches](runs/batches.md#forming-batches).

### Stage

One of the seven steps of a task that an agent runs: `plan`, `route`, `web`, `design`, `code`, `test` and `review`. Every agent run is a stage; recording answers and accepting workflows are not. See [stages](tasks/stages.md).

### Staged workflow

A workflow file that the agent wrote under `.github/workflows/`, which `apply` commits under `.codeman/workflows/` instead. It reaches `.github/workflows/` only when a maintainer accepts it with `/codeman accept-workflows`. See [on-demand workflows](runs/changes.md#on-demand-workflows).

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

### Task's commands

The `/codeman set` commands of a [task](#task), in its issue's description and comments: the sixth [layer](#layer). They set only `model`, `task-budget`, `max-runs`, `language` and `gpu`, and the last one for a setting wins. See [layers](settings/reference.md#layers).

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
